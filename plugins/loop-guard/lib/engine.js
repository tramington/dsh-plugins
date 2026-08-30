/**
 * @dsh-local/loop-guard — 空转检测纯逻辑引擎（无 cordis 依赖，可独立单测）。
 *
 * 两个纯函数：
 * - fingerprint(root, options)：工作区产出指纹（文件树 path+size+mtimeMs 折叠为
 *   FNV-1a 32 位 hex）。任何扫描失败返回 null —— 调用方降级为"不检测"。
 * - createIdleTracker(options)：轮次状态机。每轮结束喂入 (goalView, fingerprint)，
 *   连续 threshold 轮指纹不变 → warning=true。
 *
 * 崩溃安全：引擎不抛异常（内部全部 try/catch），失败只返回 null/计数不变。
 */
import { readdirSync, statSync, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_OPTIONS = {
	maxDepth: 5, // 递归深度上限（防深目录失控）
	maxEntries: 3000, // 计入指纹的文件数上限（防大仓库失控）
	skipDot: true, // 跳过 . 开头的条目（.git/.DS_Store/.env.local 等）
	skipDirs: new Set(['node_modules', 'dist', 'coverage', '.next'])
}

/** 逐字符折叠字符串进 FNV-1a 哈希。 */
function fnv1a(h, text) {
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return h >>> 0
}

/**
 * 计算目录树的产出指纹。文件顺序按名称排序保证确定性；
 * 目录内容变化（增删改文件）都会改变指纹。
 * @param {string} root - 绝对路径
 * @param {object} [options] - 覆盖 DEFAULT_OPTIONS
 * @returns {string|null} 32 位 hex 指纹；根不可用/扫描失败返回 null
 */
export function fingerprint(root, options = {}) {
	const opts = { ...DEFAULT_OPTIONS, ...options }
	if (typeof root !== 'string' || root.length === 0) return null
	let st
	try {
		st = statSync(root)
	} catch {
		return null
	}
	if (!st.isDirectory()) return null
	let h = 0x811c9dc5
	let count = 0
	const walk = (dir, depth) => {
		if (depth > opts.maxDepth || count > opts.maxEntries) return
		let names
		try {
			names = readdirSync(dir).sort()
		} catch {
			return
		}
		for (const name of names) {
			if (count > opts.maxEntries) return
			if (opts.skipDot && name.startsWith('.')) continue
			const p = join(dir, name)
			let entry
			try {
				entry = statSync(p)
			} catch {
				continue
			}
			if (entry.isDirectory()) {
				if (opts.skipDirs.has(name)) continue
				walk(p, depth + 1)
			} else if (entry.isFile()) {
				count++
				h = fnv1a(h, `${p}\0${entry.size}\0${entry.mtimeMs}\n`)
			}
		}
	}
	walk(root, 0)
	return (h >>> 0).toString(16)
}

/**
 * 创建轮次空转状态机（每 agent 一个实例）。
 * @param {object} [options]
 * @param {number} [options.threshold=3] - 连续无变化轮数阈值
 */
export function createIdleTracker(options = {}) {
	const threshold = Number.isFinite(options.threshold) && options.threshold > 0 ? options.threshold : 3
	let goalId = null // 当前追踪的 goal
	let boundary = null // { round, fp } —— 最近一次轮结束采样
	let noChange = 0 // 连续无变化轮数

	/**
	 * 每轮结束时调用。
	 * @param {object|null} goal - ctx.goals.get(agent) 的视图（含 id/phase/roundsStarted）
	 * @param {string|null} fp - 本轮结束时的工作区指纹（不可用传 null）
	 * @returns {{goalId:string|null, noChange:number, warning:boolean}}
	 */
	function onRoundEnd(goal, fp) {
		if (!goal || goal.phase !== 'active') {
			// 无 goal / 非 active（paused/blocked/complete）：停止计数，保留 goal 识别
			boundary = null
			noChange = 0
			return { goalId, noChange: 0, warning: false }
		}
		if (goal.id !== goalId) {
			// goal 更换（含完成后再建）：全新起点
			goalId = goal.id
			boundary = null
			noChange = 0
		}
		const round = goal.roundsStarted
		// 只在新轮边界（roundsStarted 前进）时采样；同一轮内的多次 turn/end 忽略
		if (boundary === null || round > boundary.round) {
			if (boundary !== null && boundary.fp !== null && fp !== null) {
				if (fp === boundary.fp) noChange++
				else noChange = 0
			}
			boundary = { round, fp }
		}
		const warning = noChange >= threshold
		return { goalId, noChange, warning }
	}

	return {
		onRoundEnd,
		/** 完全重置（agent 销毁/会话重置时调用）。 */
		reset() {
			goalId = null
			boundary = null
			noChange = 0
		}
	}
}

/**
 * P1.3 回滚能力：构建一条 goal 变更历史条目（markdown，追加式）。
 * @param {object} notification - goal/changed 事件的 change 对象（{operation, goal}）
 * @param {Date} [at] - 记录时间（默认 now）
 * @returns {string|null} markdown 条目；notification/goal 缺失返回 null
 */
export function historyEntry(notification, at = new Date()) {
	if (!notification || !notification.goal) return null
	const goal = notification.goal
	return [
		`## rev ${goal.revision} · ${notification.operation || 'unknown'} · ${at.toISOString()}`,
		`objective: ${goal.objective}`,
		''
	].join('\n')
}

/**
 * P1.3 回滚能力：把历史条目追加写入 <dir>/<goalId>.md。
 * 崩溃安全：任何失败返回 false（不抛异常，调用方静默降级）。
 * @param {string} dir - 历史目录（如 <工作区>/.goal-history）
 * @param {string} goalId - goal id（用作文件名）
 * @param {string} entry - historyEntry 生成的条目
 * @returns {boolean} 是否写入成功
 */
export function appendHistoryEntry(dir, goalId, entry) {
	try {
		mkdirSync(dir, { recursive: true })
		appendFileSync(join(dir, `${goalId}.md`), entry, 'utf8')
		return true
	} catch {
		return false
	}
}
