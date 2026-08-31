/**
 * @dsh-local/loop-rules — P0 优化：目标可验证性与完成证据规则。
 *
 * 实现方式：仅注册 system-prompt section（prompt 层），不触碰任何运行时
 * 逻辑——DSH 核心、goal/ralph 循环、工具行为均不受影响。
 *
 * 崩溃安全设计：
 * 1. 注册全程 try/catch，失败静默降级（不影响任何功能）
 * 2. 纯文本注入，无执行路径，不可能导致进程崩溃
 * 3. 可恢复：从 profile 卸载本插件即完全恢复原状
 *
 * 规则内容（P0）：
 * - 目标可验证性：objective 必须含可验证成功标准
 * - 完成证据：complete/完成声明必须附可检查证据
 * - 阻塞报告：具体条件 + 已尝试措施
 */
const name = '@dsh-local/loop-rules'
const inject = ['systemPrompt']

const RULES_TEXT = [
	'## 目标可验证性与完成证据规则（P0，适用 goal 与 ralph 循环）',
	'',
	'### 1. 可验证目标（objective）',
	'- 创建/更新 goal 或启动 ralph 前：objective 必须包含**可验证的成功标准**（明确可观察的结果：文件路径、数字、测试通过率、状态值）',
	'- 目标不可验证时：先向用户澄清或补充成功标准，不直接接受模糊目标',
	'',
	'### 2. 完成证据（evidence）',
	'- 报告完成（goal complete / ralph 完成声明）时**必须附证据**：具体文件路径、验证结果（如 "48/48 测试通过"）、可检查的数字或状态',
	'- 禁止无证据的完成声明（"已完成"必须带可检查依据）',
	'- 无法提供证据时：报告为"部分完成/受阻"，并说明缺少什么证据',
	'',
	'### 3. 阻塞报告（blocked）',
	'- 说明具体阻塞条件（事实描述，如 "X 接口连续 5 次超时"）和已尝试的措施',
	'- 避免模糊描述（"遇到困难"→ 具体现象）'
].join('\n')

/** 底层编码防错规则（0.1.1 新增）：跨会话自动注入，不依赖主动遍历规则库。 */
const BASELINE_TEXT = [
	'## 通用编码防错规则（loop-rules 0.1.1，适用所有任务）',
	'',
	'1. **先读后写（R1.1）**：edit 前必须 read 目标文件，old_string 从实际内容复制；服务重启后所有文件的已读状态清空，重启后第一次 edit 前必须重新 read',
	'2. **先查后调（R1.9）**：路径/token/ID 一律从文件或工具返回值获取，不凭记忆输入',
	'3. **先验后用（R1.7）**：用户提供的信息（token/链接/数字）先验证再使用',
	'4. **先示后行（R1.8）**：删除/覆盖/高危操作先展示精确内容（dry-run/清单）再执行',
	'5. **三段验证（R1.3）**：生成/注入代码后①产物回读②格式校验（语法/lint）③最小行为测试',
	'6. **遍历规则（R0.4）**：需求明确后、出方案前，主动遍历 CODING-RULES（dsh-memory 仓库完整版）把适用规则融入方案'
].join('\n')

/** ralph 结构化 handoff 规则（0.1.2 新增）：每轮落盘 ROUND 文件，替代纯聊天报告。 */
const HANDOFF_TEXT = [
	'## ralph 结构化 handoff（loop-rules 0.1.2，适用 ralph 循环）',
	'',
	'1. **每轮落盘**：每轮结束时（报告完成/阻塞前），写 `.rounds/ROUND-<n>.md` 到工作区（n = `.rounds/` 目录已有文件数 + 1，从 1 开始）',
	'2. **格式固定**（四段，缺一不可）：',
	'   - `# ROUND <n>`',
	'   - `## 目标`：objective 原文',
	'   - `## 已完成（含证据）`：本轮完成事项 + 可检查证据（文件路径/数字/验证结果）',
	'   - `## 阻塞`：具体条件（无则写"无"）',
	'   - `## 下一步`：下轮待办清单',
	'3. **跨轮恢复**：新一轮开始时，先读 `.rounds/` 目录中最新 ROUND 文件恢复上下文（工作区是唯一跨轮记忆）',
	'4. **报告引用**：完成/阻塞报告必须引用 ROUND 文件路径作为证据（同 P0 完成证据规则）',
	'5. **崩溃安全**：ROUND 写失败不阻塞主流程（try/catch），但要在报告中说明'
].join('\n')

/** goal 回滚能力规则（0.1.3 新增）：恶化时从自动变更历史恢复旧 objective。 */
const ROLLBACK_TEXT = [
	'## goal 回滚能力（loop-rules 0.1.3，适用 goal 循环）',
	'',
	'1. **历史自动记录**：loop-guard 会在每次 goal 变更时自动追加 `<工作区>/.goal-history/<goalId>.md`（含 revision、操作、objective 全文），无需手动维护',
	'2. **恶化信号**（任一即评估回滚）：①loop-guard 空转警告出现 ②产出明显偏离 objective ③用户指出目标漂移',
	'3. **回滚动作**：调用 update_goal edit，把 objective 恢复为 `.goal-history/<goalId>.md` 中**上一 revision** 的原文（逐字复制，禁止改写）',
	'4. **回滚报告**：说明"已回滚到 revision N-1 的 objective"，引用历史文件路径作为证据；若历史缺失，先从会话记录恢复原文，并在报告中说明',
	'5. **崩溃安全**：历史文件读不到时禁止凭记忆改写回滚（R1.9），宁可不回滚并报告'
].join('\n')

/** 目标漂移检测规则（0.1.4 新增）：每轮重申目标 + 轮末对照检查（成本极低）。 */
const DRIFT_TEXT = [
	'## 目标漂移检测（loop-rules 0.1.4，适用 ralph 循环）',
	'',
	'1. **轮首重申**：每轮开始时，先用一句话重申本轮 objective 的核心要求（对照轮次消息中的 objective 原文，禁止改写），并声明本轮工作范围',
	'2. **轮末对照**：报告完成/阻塞前，对照 objective 逐条检查本轮产出是否对齐；未对齐项必须显式列出（该做什么 vs 实际做了什么）',
	'3. **发现漂移**：立即停止跑偏方向，回到 objective 主线；将偏离点记录在 ROUND 文件的"阻塞"或"已完成"中（如实说明偏差）',
	'4. **诱饵警惕**：执行中发现的"有趣但无关"的子问题不展开深挖；只记录为"下一步候选"（若确属 objective 必需，须说明关联）'
].join('\n')

/** P2 完成审批门 + 成功模板沉淀规则（0.1.5 新增）。 */
const P2_TEXT = [
	'## 完成审批门与成功模板沉淀（loop-rules 0.1.5，适用 goal 循环）',
	'',
	'### 1. 完成审批门',
	'- 调用 complete 前：先向用户呈现**完成证据摘要**（目标/产出/验证结果/产物路径），等待用户确认',
	'- 用户明确确认（或事先已授权自动完成）后才可 complete；未确认前不得 complete，报告"等待用户确认"',
	'- 自动续跑中用户不在线：以带证据的 complete 报告代替人工确认（P0 证据规则兜底），并在报告中注明"未经人工确认"',
	'',
	'### 2. 成功模板沉淀（06 层正反馈）',
	'- 连续完成 3 个目标后：回顾已完成的 objective，提炼可复用的**目标结构模板**（按类型：验证类/实现类/迁移类等的成功标准写法）',
	'- 沉淀：追加到 `<工作区>/memory/009-loop-roadmap.md` 的「成功目标模板」节（或工作区 `.goal-templates.md`），内容 = 模板结构 + 2-3 个成功实例',
	'- 崩溃安全：沉淀写失败不影响完成报告'
].join('\n')

/** loop 教训沉淀规则（0.1.6 新增，P3）：错误→lessons learned→下轮应用。 */
const LEARN_TEXT = [
	'## loop 教训沉淀（loop-rules 0.1.6，适用 goal 与 ralph 循环）',
	'',
	'1. **错误自动记录**：loop-learn 会把工具失败（tool/result 带 error）自动追加到 `<工作区>/.lessons/errors/errors-<日期>.md`，无需手动维护',
	'2. **每轮整理**：轮次结束时（报告前），查看 `.lessons/errors/` 中本轮新增的原始错误，整理为 **lessons learned** 追加到 `<工作区>/.lessons/learned.md`，格式固定三段式：',
	'   - `## 教训 <n> · <日期>`',
	'   - `现象：`（错误事实，如 "edit 报 requires reading first"）',
	'   - `根因：`（为什么发生）',
	'   - `规则：`（以后怎么做，可执行）',
	'3. **重新注入**：loop-learn 会把最近教训注入运行时 context（每步可见）——执行前对照检查是否涉及已知坑；涉及则直接应用规则，不再重犯',
	'4. **长期沉淀**：同一教训重复出现 2 次以上或用户认可后，合并进 CODING-RULES（dsh-memory 完整版），标注来源',
	'5. **崩溃安全**：记录/整理失败不阻塞轮次（静默降级）'
].join('\n')

function apply(ctx) {
	try {
		ctx.effect(() => ctx.systemPrompt.section({
			name: 'plugin:loop-rules',
			order: 205,
			text: RULES_TEXT
		}), 'loop-rules: P0 evidence rules section')
		ctx.effect(() => ctx.systemPrompt.section({
			name: 'plugin:loop-rules:baseline',
			order: 206,
			text: BASELINE_TEXT
		}), 'loop-rules: baseline coding rules section')
		ctx.effect(() => ctx.systemPrompt.section({
			name: 'plugin:loop-rules:handoff',
			order: 207,
			text: HANDOFF_TEXT
		}), 'loop-rules: ralph handoff section')
		ctx.effect(() => ctx.systemPrompt.section({
			name: 'plugin:loop-rules:rollback',
			order: 208,
			text: ROLLBACK_TEXT
		}), 'loop-rules: goal rollback section')
		ctx.effect(() => ctx.systemPrompt.section({
			name: 'plugin:loop-rules:drift',
			order: 209,
			text: DRIFT_TEXT
		}), 'loop-rules: ralph drift detection section')
		ctx.effect(() => ctx.systemPrompt.section({
			name: 'plugin:loop-rules:p2',
			order: 210,
			text: P2_TEXT
		}), 'loop-rules: approval gate and template section')
		ctx.effect(() => ctx.systemPrompt.section({
			name: 'plugin:loop-rules:learn',
			order: 211,
			text: LEARN_TEXT
		}), 'loop-rules: loop lesson section')
	} catch (e) {
		// 静默降级：规则注入失败不影响任何功能
		if (ctx.logger && typeof ctx.logger.warn === 'function') {
			ctx.logger.warn('loop-rules: section registration failed: ' + (e && e.message ? e.message : String(e)))
		}
	}
}

export { name, inject, apply }
