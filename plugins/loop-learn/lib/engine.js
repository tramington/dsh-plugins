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
	const text = extractText(msg)
	const name = data.error.name || 'UnknownError'
	const code = data.error.code !== void 0 ? ` (${data.error.code})` : ''
	const tool = (msg && msg.source && msg.source.kind) || 'tool'
	const toolName = tool === 'tool' ? (data.meta && data.meta.name) || '' : tool
	return [
		`- ${at.toISOString()} · **${name}${code}** · ${toolName}`,
		`  text: ${text.length > 400 ? text.slice(0, 400) + '…' : text}`
	].join('\n')
}

/** 提取 message 里第一个 text 块的内容（失败样本实证：错误文本在 content[].content[].text）。 */
export function extractText(msg) {
	try {
		for (const block of msg.content || []) {
			if (block.type === 'tool-result' && Array.isArray(block.content)) {
				for (const c of block.content) {
					if (c.type === 'text' && typeof c.text === 'string') return c.text.replace(/\s+/g, ' ').trim()
				}
			}
		}
	} catch {
		/* 静默 */
	}
	return ''
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
		// 按 "## 教训" 切块，取尾部 limit 条
		const parts = text.split(/(?=^## 教训 )/m).map(s => s.trim()).filter(Boolean)
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
