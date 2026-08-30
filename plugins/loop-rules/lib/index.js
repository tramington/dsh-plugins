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
	} catch (e) {
		// 静默降级：规则注入失败不影响任何功能
		if (ctx.logger && typeof ctx.logger.warn === 'function') {
			ctx.logger.warn('loop-rules: section registration failed: ' + (e && e.message ? e.message : String(e)))
		}
	}
}

export { name, inject, apply }
