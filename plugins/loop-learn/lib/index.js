/**
 * @dsh-local/loop-learn — P3 错误→教训→注入闭环（node 半）。
 *
 * 目标：把 loop 执行中的错误自动记录、由 agent 整理为 lessons learned、
 * 并在下一轮重新注入——形成"踩坑→沉淀→不再重犯"的反馈回路。
 *
 * 实现：
 * 1. 订阅 session/event 的 tool/result：data.error 存在（实证：本会话
 *    390 个工具结果中 11 个失败均带 error）→ 追加到
 *    <工作区>/.lessons/errors/errors-<日期>.md（原始错误日志）
 * 2. 动态 context（每步重算）：读 <工作区>/.lessons/learned.md 尾部 N 条
 *    教训注入"## 最近教训（loop-learn）"——有教训才注入，无则空串零污染
 * 3. agent 每轮整理的规则在 loop-rules 0.1.6「loop 教训沉淀」section
 *
 * 崩溃安全：全程 try/catch；写入失败静默降级；卸载即恢复。
 */
import { errorEntry, appendError, readLatestLessons } from './engine.js'
import { join } from 'node:path'
import { statSync } from 'node:fs'

const name = '@dsh-local/loop-learn'
const inject = ['systemPrompt', 'agents']

/** 工作区下的教训目录。 */
const LESSONS_DIR = '.lessons'
/** 动态 context 注册名与排序（紧随 loop-rules 205-211 系列）。 */
const LESSONS_CONTEXT_NAME = 'plugin:loop-learn:lessons'
const LESSONS_CONTEXT_ORDER = 212
/** 注入的最大教训条数与注入文本长度上限。 */
const INJECT_LIMIT = 5
const INJECT_TEXT_LIMIT = 6000
/** 教训文件缓存（避免每步重读磁盘）。 */
const cache = { mtimeMs: 0, text: '' }

function renderLessons(lessons) {
	return [
		'## 📚 最近教训（loop-learn，P3）',
		'',
		'以下为本会话已沉淀的最近教训（来源 `.lessons/learned.md`），执行前对照检查是否涉及已知坑：',
		'',
		...lessons
	].join('\n\n')
}

function apply(ctx) {
	try {
		ctx.effect(() => {
			const disposers = []

			// 1. 错误自动捕获：tool/result 失败 → 落盘原始错误日志
			disposers.push(ctx.on('session/event', (session, event) => {
				try {
					if (event.type !== 'tool/result') return
					const data = event.data
					if (!data || !data.error) return
					const agent = ctx.agents && ctx.agents.get(session.id)
					if (!agent) {
						if (ctx.logger && typeof ctx.logger.warn === 'function') {
							ctx.logger.warn(`loop-learn: agent not found for session "${session.id}" (inject 'agents' missing?)`)
						}
						return
					}
					const cwd = agent.session.header.cwd
					if (typeof cwd !== 'string' || cwd.length === 0) return
					const entry = errorEntry(event)
					if (entry === null) return
					const ok = appendError(join(cwd, LESSONS_DIR, 'errors'), entry)
					if (!ok && ctx.logger && typeof ctx.logger.warn === 'function') {
						ctx.logger.warn('loop-learn: error append failed for session ' + session.id)
					}
				} catch (e) {
					if (ctx.logger && typeof ctx.logger.warn === 'function') {
						ctx.logger.warn('loop-learn: capture failed: ' + (e && e.message ? e.message : String(e)))
					}
				}
			}))

			// 2. 教训注入：动态 context（每步重算；文件 mtime 缓存）
			disposers.push(ctx.systemPrompt.context({
				name: LESSONS_CONTEXT_NAME,
				order: LESSONS_CONTEXT_ORDER,
				text: (assemblyCtx) => {
					try {
						const agent = assemblyCtx && assemblyCtx.agent
						if (!agent) return ''
						const cwd = agent.session.header.cwd
						if (typeof cwd !== 'string' || cwd.length === 0) return ''
						const file = join(cwd, LESSONS_DIR, 'learned.md')
						let mtimeMs = 0
						try {
							mtimeMs = requireStatMtime(file)
						} catch {
							return ''
						}
						if (mtimeMs !== cache.mtimeMs) {
							cache.mtimeMs = mtimeMs
							const lessons = readLatestLessons(join(cwd, LESSONS_DIR), INJECT_LIMIT)
							cache.text = lessons.length > 0 ? renderLessons(lessons) : ''
						}
						return cache.text.length <= INJECT_TEXT_LIMIT ? cache.text : cache.text.slice(0, INJECT_TEXT_LIMIT) + '\n…（截断）'
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
		}, 'loop-learn: error capture and lesson injection')
	} catch (e) {
		if (ctx.logger && typeof ctx.logger.warn === 'function') {
			ctx.logger.warn('loop-learn: apply failed: ' + (e && e.message ? e.message : String(e)))
		}
	}
}

/** 取文件 mtime（失败抛异常由调用方捕获）。 */
function requireStatMtime(file) {
	return statSync(file).mtimeMs
}

export { name, inject, apply }
