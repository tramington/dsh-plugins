/**
 * loop-guard 引擎最小行为测试（R1.3 三段验证之③）。
 * 运行：node test/engine.test.mjs （从插件目录）
 * 覆盖：指纹稳定性/敏感性 + 空转状态机触发/恢复/goal 更换/降级。
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fingerprint, createIdleTracker } from '../lib/engine.js'

let passed = 0
let failed = 0
function check(label, cond) {
	if (cond) {
		passed++
		console.log(`  ✅ ${label}`)
	} else {
		failed++
		console.error(`  ❌ ${label}`)
	}
}

// ---------- 指纹：稳定性与敏感性 ----------
console.log('1) fingerprint')
const root = mkdtempSync(join(tmpdir(), 'loop-guard-test-'))
try {
	writeFileSync(join(root, 'a.txt'), 'hello')
	mkdirSync(join(root, 'sub'))
	writeFileSync(join(root, 'sub', 'b.txt'), 'world')
	writeFileSync(join(root, '.hidden'), 'skip-me')
	writeFileSync(join(root, '.DS_Store'), 'skip-me-too')

	const fp1 = fingerprint(root)
	check('存在且非 null', typeof fp1 === 'string' && fp1.length > 0)
	check('幂等（两次扫描相同）', fp1 === fingerprint(root))

	writeFileSync(join(root, 'a.txt'), 'hello!') // 内容变化
	const fp2 = fingerprint(root)
	check('文件内容变化 → 指纹变化', fp2 !== fp1)

	writeFileSync(join(root, 'c.txt'), 'new') // 新增文件
	const fp3 = fingerprint(root)
	check('新增文件 → 指纹变化', fp3 !== fp2)

	check('隐藏文件不影响指纹（跳过 . 开头）', fingerprint(root) === fp3)

	check('不存在路径 → null', fingerprint(join(root, 'nope')) === null)
	check('null 输入 → null', fingerprint(null) === null)
	check('文件路径（非目录）→ null', fingerprint(join(root, 'a.txt')) === null)
} finally {
	rmSync(root, { recursive: true, force: true })
}

// ---------- 状态机：触发与恢复 ----------
console.log('2) createIdleTracker')
const goal = (id, round, phase = 'active') => ({ id, phase, roundsStarted: round })

{
	const t = createIdleTracker({ threshold: 3 })
	const r1 = t.onRoundEnd(goal('g1', 1), 'FP-A') // baseline 轮
	check('首轮（baseline）无警告', r1.warning === false && r1.noChange === 0)
	const r2 = t.onRoundEnd(goal('g1', 2), 'FP-A')
	check('第 2 轮同指纹 → noChange=1 无警告', r2.noChange === 1 && r2.warning === false)
	const r3 = t.onRoundEnd(goal('g1', 3), 'FP-A')
	check('第 3 轮同指纹 → noChange=2 无警告', r3.noChange === 2 && r3.warning === false)
	const r4 = t.onRoundEnd(goal('g1', 4), 'FP-A')
	check('第 4 轮同指纹 → 触发警告', r4.noChange === 3 && r4.warning === true)
	const r5 = t.onRoundEnd(goal('g1', 5), 'FP-B') // 有产出
	check('指纹变化 → 计数清零、警告解除', r5.noChange === 0 && r5.warning === false)
}

{
	// goal 更换 → 全新起点
	const t = createIdleTracker({ threshold: 2 })
	t.onRoundEnd(goal('g1', 1), 'FP-A')
	t.onRoundEnd(goal('g1', 2), 'FP-A')
	check('g1 连续 2 轮 → 警告', t.onRoundEnd(goal('g1', 3), 'FP-A').warning === true)
	const r = t.onRoundEnd(goal('g2', 1), 'FP-A') // 新 goal（同指纹也重置）
	check('goal 更换 → 重置，无警告', r.warning === false && r.noChange === 0)
}

{
	// 非 active（pause/complete）→ 停止计数
	const t = createIdleTracker({ threshold: 2 })
	t.onRoundEnd(goal('g1', 1), 'FP-A')
	t.onRoundEnd(goal('g1', 2), 'FP-A')
	const r = t.onRoundEnd(goal('g1', 2, 'paused'), 'FP-A')
	check('phase=paused → 计数清零无警告', r.warning === false && r.noChange === 0)
}

{
	// 指纹不可用（null）→ 不误判、不计数
	const t = createIdleTracker({ threshold: 2 })
	t.onRoundEnd(goal('g1', 1), 'FP-A')
	const r1 = t.onRoundEnd(goal('g1', 2), null)
	check('指纹 null → 不计数无警告', r1.warning === false && r1.noChange === 0)
	const r2 = t.onRoundEnd(goal('g1', 3), 'FP-A')
	check('随后恢复可用指纹 → baseline 比较从本轮起', r2.warning === false)
}

{
	// 同一轮内多次 turn/end（roundsStarted 未前进）→ 忽略
	const t = createIdleTracker({ threshold: 2 })
	t.onRoundEnd(goal('g1', 1), 'FP-A')
	const r = t.onRoundEnd(goal('g1', 1), 'FP-A') // 同轮第二次
	check('同轮重复采样 → 忽略不计', r.noChange === 0 && r.warning === false)
}

// ---------- 汇总 ----------
console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
