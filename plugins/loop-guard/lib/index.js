/**
 * @dsh-local/loop-guard — P1.1 空转检测（node 半，事件 + 动态 context）。
 *
 * 目标：goal 自动续跑循环中，连续 N 轮"工作区产出指纹无变化" → 在运行时
 * context 中注入空转警告，提示 agent 暂停或换策略（防 token 空烧）。
 *
 * 信号源（独立评估，非自报式）：
 * - goal/changed、session/event(turn/end) 事件 → 轮次边界
 * - ctx.goals.get(agent) → 轮次计数（roundsStarted）
 * - agent.session.meta.cwd → 工作区路径 → 产出指纹（engine.fingerprint）
 *
 * 崩溃安全设计：
 * 1. 注册全程 try/catch，失败静默降级（不影响任何功能）
 * 2. 指纹扫描失败 → 该 agent 降级为"不检测"（不计数、不警告）
 * 3. 警告经动态 context（函数文本，每步重算）投递：无警告时返回空串，
 *    对 prompt 零污染；context 注册失败静默跳过
 * 4. 卸载本插件即完全恢复原状
 */
import { fingerprint, createIdleTracker } from './engine.js'

const name = '@dsh-local/loop-guard'
const inject = ['goals', 'agents', 'systemPrompt']

/** 连续多少轮指纹无变化判定为空转（含首轮 baseline 后的第 N 轮）。 */
const IDLE_THRESHOLD = 3
/** 动态 context 的注册名与排序（紧随 loop-rules 的 205）。 */
const WARNING_CONTEXT_NAME = 'plugin:loop-guard:idle-warning'
const WARNING_CONTEXT_ORDER = 210

function renderWarning(w) {
	return [
		'## ⚠️ 空转检测警告（loop-guard，P1.1）',
		'',
		`检测到当前 goal 已连续 **${w.noChange} 轮** 工作区产出无实质变化（文件指纹未变）——疑似空转（重复读取/重复搜索/自说自话而无文件产出）。`,
		'',
		'请立即执行：',
		'1. 评估当前策略是否在空转；',
		`2. 若确认空转：调用 update_goal 执行 **pause**（或 blocked）停止自动续跑，改为向用户报告并等待指示；`,
		'3. 若本轮产出为纯分析结论（无需落盘）：在回复开头声明"本轮产出为分析结论，不落盘"，然后正常继续。'
	].join('\n')
}

function apply(ctx) {
	/** key = agent.session.id → { noChange, at }（当前生效中的警告） */
	const warnings = new Map()
	/** key = agent.session.id → tracker 状态机 */
	const trackers = new Map()
	/** key = agent.session.id → 最近见到的 goal id（用于 goal 更换时清警告） */
	const lastGoalIds = new Map()

	const trackerFor = (agent) => {
		const key = agent.session.id
		let t = trackers.get(key)
		if (!t) {
			t = createIdleTracker({ threshold: IDLE_THRESHOLD })
			trackers.set(key, t)
		}
		return t
	}

	try {
		ctx.effect(() => {
			const disposers = []

			// 轮结束采样：指纹 + 状态机 → 更新警告表
			disposers.push(ctx.on('session/event', (session, event) => {
				try {
					if (event.type !== 'turn/end') return
					const agent = ctx.agents.get(session.id)
					if (!agent) return
					const goal = ctx.goals.get(agent)
					if (!goal || goal.phase !== 'active') return
					// 工作区路径在 session.header.cwd（session 创建元数据），非 meta
					const fp = fingerprint(agent.session.header.cwd)
					const t = trackerFor(agent)
					const res = t.onRoundEnd(goal, fp)
					if (res.warning) {
						warnings.set(session.id, { noChange: res.noChange, at: Date.now() })
						if (ctx.logger && typeof ctx.logger.warn === 'function') {
							ctx.logger.warn(`loop-guard: idle warning for agent "${session.id}": ${res.noChange} rounds without workspace fingerprint change`)
						}
					} else {
						warnings.delete(session.id)
					}
				} catch (e) {
					// 静默降级：单次采样失败不影响后续
					if (ctx.logger && typeof ctx.logger.warn === 'function') {
						ctx.logger.warn(`loop-guard: turn/end sample failed: ${e && e.message ? e.message : String(e)}`)
					}
				}
			}))

			// goal 变更：非 active 或更换 goal → 立即清警告（无需等下一次 turn/end）
			disposers.push(ctx.on('goal/changed', ({ agent }) => {
				try {
					if (!agent) return
					const key = agent.session.id
					let goal = null
					try {
						goal = ctx.goals.get(agent)
					} catch {
						goal = null
					}
					if (!goal || goal.phase !== 'active') {
						warnings.delete(key)
						return
					}
					const last = lastGoalIds.get(key)
					if (last !== undefined && last !== goal.id) {
						// goal 更换（完成后再建/新目标）：全新起点
						lastGoalIds.set(key, goal.id)
						const t = trackers.get(key)
						if (t) t.reset()
						warnings.delete(key)
					} else if (last === undefined) {
						lastGoalIds.set(key, goal.id)
					}
				} catch (e) {
					if (ctx.logger && typeof ctx.logger.warn === 'function') {
						ctx.logger.warn(`loop-guard: goal/changed handler failed: ${e && e.message ? e.message : String(e)}`)
					}
				}
			}))

			// agent 销毁：清理状态，防泄漏
			disposers.push(ctx.on('agent/disposed', ({ agent }) => {
				try {
					if (!agent) return
					const key = agent.session.id
					warnings.delete(key)
					trackers.delete(key)
					lastGoalIds.delete(key)
				} catch {
					/* 静默 */
				}
			}))

			// 警告投递：动态 context（每步重算；无警告返回空串 → 零污染）
			disposers.push(ctx.systemPrompt.context({
				name: WARNING_CONTEXT_NAME,
				order: WARNING_CONTEXT_ORDER,
				text: (assemblyCtx) => {
					try {
						const agent = assemblyCtx && assemblyCtx.agent
						if (!agent) return ''
						const w = warnings.get(agent.session.id)
						return w ? renderWarning(w) : ''
					} catch {
						return ''
					}
				}
			}))

			return () => {
				for (const dispose of disposers) {
					try {
						dispose()
					} catch {
						/* 静默 */
					}
				}
			}
		}, 'loop-guard: idle detection')
		if (ctx.logger && typeof ctx.logger.info === 'function') {
			ctx.logger.info(`loop-guard: idle detection armed (threshold=${IDLE_THRESHOLD} rounds, workspace fingerprint per turn/end)`)
		}
	} catch (e) {
		if (ctx.logger && typeof ctx.logger.warn === 'function') {
			ctx.logger.warn('loop-guard: apply failed: ' + (e && e.message ? e.message : String(e)))
		}
	}
}

export { name, inject, apply }
