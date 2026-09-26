/**
 * @dsh-local/loop-learn — 纯逻辑引擎（无 cordis 依赖，可独立单测）。
 *
 * 职责：
 * - errorEntry()：把 tool/result 失败事件提取为 markdown 错误记录行
 * - appendError()：追加错误到 <工作区>/.lessons/errors/errors-<日期>.md
 * - readLatestLessons()：读 <工作区>/.lessons/learned.md 尾部 N 条教训（供动态 context 注入）
 *
 * 崩溃安全：所有函数失败返回 null/false/[]，不抛异常（调用方静默降级）。
 */
import { mkdirSync, appendFileSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/** 从 tool/result 事件提取错误记录行（markdown 追加格式）。 */
export function errorEntry(event, at = new Date()) {
	const data = event && event.data
	if (!data || !data.error) return null
	const msg = data.message
	let text = extractText(msg)
	if (!text) text = extractText(data.error) // 兜底：错误对象自带 message
	if (!text) text = '(事件未携带错误文本)'
	const name = data.error.name || 'UnknownError'
	const code = data.error.code !== void 0 ? ` (${data.error.code})` : ''
	const kind = (msg && msg.source && msg.source.kind) || 'tool'
	// 0.1.7 起 tool/result 事件不再带 data.meta（实测为 null）→ 工具名为空时不留悬空分隔符
	const toolName = (data.meta && data.meta.name) || (kind !== 'tool' ? kind : '')
	const head = `- ${at.toISOString()} · **${name}${code}**`
	return [
		toolName ? `${head} · ${toolName}` : head,
		`  text: ${text.length > 400 ? text.slice(0, 400) + '…' : text}`
	].join('\n')
}

/**
 * 提取错误文本：对消息结构做**形状无关**的递归查找。
 *
 * 背景（2026-09-26 实测）：0.1.5 的 edit 类失败文本在 content[].content[].text，
 * 而 0.1.7 的 read 类失败在 content[] 直接挂 text——按固定层级取会漏，落盘成空 text。
 * 策略：优先取第一个非空 text 字段，按 content/message/result/error/... 递归兜底；
 * 找不到返回空串（调用方再兜底），全程不抛。
 */
export function extractText(input) {
	const seen = new Set()
	const walk = (node, depth) => {
		if (node == null || depth > 6) return ''
		if (typeof node === 'string') return node.trim() !== '' ? node : ''
		if (Array.isArray(node)) {
			for (const item of node) {
				const r = walk(item, depth + 1)
				if (r) return r
			}
			return ''
		}
		if (typeof node !== 'object' || seen.has(node)) return ''
		seen.add(node)
		if (typeof node.text === 'string' && node.text.trim() !== '') return node.text
		for (const key of ['content', 'message', 'result', 'error', 'data', 'body', 'detail']) {
			if (key in node) {
				const r = walk(node[key], depth + 1)
				if (r) return r
			}
		}
		return ''
	}
	try {
		return walk(input, 0).replace(/\s+/g, ' ').trim()
	} catch {
		return ''
	}
}

/** 按天追加错误记录到 <dir>/errors-<YYYY-MM-DD>.md。失败返回 false。 */
export function appendError(dir, entry, at = new Date()) {
	try {
		mkdirSync(dir, { recursive: true })
		const day = at.toISOString().slice(0, 10)
		appendFileSync(join(dir, `errors-${day}.md`), `${entry}\n`, 'utf8')
		return true
	} catch {
		return false
	}
}

/** 读 .lessons/learned.md 尾部 N 条"教训"条目（## 教训 <n> 开头）。文件缺失返回 []。 */
export function readLatestLessons(dir, limit = 5) {
	try {
		const file = join(dir, 'learned.md')
		if (statSync(file).isFile() !== true) return []
		const text = readFileSync(file, 'utf8')
		// 按 "## 教训" 切块；过滤头部/空块（不以 "## 教训" 开头），取尾部 limit 条
		const parts = text.split(/(?=^## 教训 )/m).map(s => s.trim()).filter(s => s.startsWith('## 教训 '))
		return parts.slice(-limit)
	} catch {
		return []
	}
}

/** 列出 .lessons/errors/ 下的错误日志文件名（供 agent 整理时定位）。失败返回 []。 */
export function listErrorFiles(dir) {
	try {
		return readdirSync(dir).filter(f => f.startsWith('errors-') && f.endsWith('.md')).sort()
	} catch {
		return []
	}
}
