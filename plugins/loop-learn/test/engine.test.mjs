/**
 * loop-learn 引擎最小行为测试（R1.3 三段验证之③）。
 * 运行：node test/engine.test.mjs （从插件目录）
 * 覆盖：errorEntry 提取 / appendError 落盘 / readLatestLessons 尾部读取 / listErrorFiles。
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { errorEntry, appendError, readLatestLessons, listErrorFiles, extractText } from '../lib/engine.js'

let passed = 0
let failed = 0
function check(label, cond) {
	if (cond) { passed++; console.log(`  ✅ ${label}`) } else { failed++; console.error(`  ❌ ${label}`) }
}

console.log('1) errorEntry / extractText')
{
	const event = {
		type: 'tool/result',
		data: {
			error: { name: 'FsError', code: 'FS_NOT_OBSERVED' },
			message: {
				source: { kind: 'tool', callId: 'c1' },
				content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'Error: edit requires reading first\n  at ...' }] }]
			}
		}
	}
	const entry = errorEntry(event, new Date('2026-08-30T12:00:00Z'))
	check('条目含错误名+code', typeof entry === 'string' && entry.includes('FsError') && entry.includes('FS_NOT_OBSERVED'))
	check('条目含时间', entry.includes('2026-08-30T12:00:00.000Z'))
	check('条目含文本摘要', entry.includes('edit requires reading first'))
	check('无 error → null', errorEntry({ type: 'tool/result', data: { message: {} } }) === null)
	check('null 输入 → null', errorEntry(null) === null)
	check('extractText 提取文本', extractText(event.data.message).includes('edit requires reading'))
	check('extractText 空 → 空串', extractText({}) === '')
}

console.log('1b) 形状无关提取（0.1.7 实测形状 / R1.3 回归）')
{
	// 0.1.7 read 类失败：text 直接挂在 content[] 上（无 tool-result 包裹）
	const flat = {
		data: {
			error: { name: 'FsError', code: 'FS_NOT_FOUND' },
			message: {
				source: { kind: 'tool', callId: 'c2' },
				content: [{ type: 'text', text: 'Error: cannot read "/tmp/nope.md": not found' }]
			}
		}
	}
	const flatEntry = errorEntry(flat, new Date('2026-09-26T12:00:00Z'))
	check('扁平 content[].text 能取到', flatEntry.includes('cannot read "/tmp/nope.md"'))
	check('0.1.7 无 meta 时不留悬空分隔符', !flatEntry.split('\n')[0].endsWith('·'))

	// 错误对象自带 message 的兜底
	const errOnly = { data: { error: { name: 'XError', code: 'X', message: 'boom from error object' }, message: {} } }
	check('error.message 兜底', errorEntry(errOnly).includes('boom from error object'))

	// 完全没有文本时给占位（不再落盘空 text）
	const noText = { data: { error: { name: 'MysteryError' }, message: { content: [] } } }
	check('无文本 → 占位符', errorEntry(noText).includes('(事件未携带错误文本)'))
	check('无文本也不抛', typeof errorEntry(noText) === 'string')

	// 深层嵌套（旧形状）仍可提取 + 循环引用不挂
	const cyc = { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'deep nested error' }] }] }
	cyc.self = cyc
	check('深层嵌套可提取', extractText(cyc) === 'deep nested error')
	check('循环引用不抛', extractText(cyc.self) === 'deep nested error')
	check('null 输入 → 空串', extractText(null) === '')
}

console.log('2) appendError / listErrorFiles / readLatestLessons')
{
	const root = mkdtempSync(join(tmpdir(), 'loop-learn-test-'))
	const errDir = join(root, 'errors')
	try {
		check('追加成功', appendError(errDir, '- err1', new Date('2026-08-30T12:00:00Z')) === true)
		check('追加成功（第二条同日）', appendError(errDir, '- err2', new Date('2026-08-30T13:00:00Z')) === true)
		check('追加成功（另一天）', appendError(errDir, '- err3', new Date('2026-08-31T12:00:00Z')) === true)
		const files = listErrorFiles(errDir)
		check('按天分文件（2 个）', files.length === 2)
		check('文件名格式', files[0].startsWith('errors-') && files[0].endsWith('.md'))
		// learned.md 读取（带头部文件：头部块应被过滤）
		writeFileSync(join(root, 'learned.md'), [
			'# Lessons Learned',
			'',
			'## 教训 1 · 2026-08-30',
			'现象：A',
			'根因：B',
			'规则：C',
			'',
			'## 教训 2 · 2026-08-30',
			'现象：D',
			'根因：E',
			'规则：F'
		].join('\n'))
		const lessons = readLatestLessons(root, 1)
		check('尾部 1 条', lessons.length === 1 && lessons[0].includes('教训 2'))
		check('头部块被过滤', lessons.every(s => s.startsWith('## 教训 ')))
		check('尾部 5 条（超上限取全部）', readLatestLessons(root, 5).length === 2)
		check('文件缺失 → []', readLatestLessons(join(root, 'nope'), 5).length === 0)
		check('坏目录 append → false 不抛', appendError(null, '- x') === false)
		check('坏目录 list → []', listErrorFiles(null).length === 0)
	} finally {
		rmSync(root, { recursive: true, force: true })
	}
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
