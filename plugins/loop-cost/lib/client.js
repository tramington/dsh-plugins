/**
 * @dsh-local/loop-cost — browser half（P2 成本视图）。
 *
 * 在会话 header utilities slot（cost-gauge 右侧）显示 goal 运行成本视图：
 *   ⏱ 3/6 轮 · ¥0.42
 *
 * 数据全部来自客户端 session 投影（零 API、零轮询，事件驱动）：
 * - useProjection("goal")：goal 状态（id/phase/roundsStarted/maxGoalRounds）
 * - useProjection("tokenUsage")：会话累计 token（uncachedInput/cacheRead/output）
 * - 计价：DeepSeek V4 Flash（输入未命中 ¥1.5/M、缓存命中 ¥0.05/M、输出 ¥4.5/M；
 *   工作日北京时间 09-12/14-18 高峰 ×2；周末全天空闲价）——与 cost-gauge 同源常量
 *
 * 崩溃安全：无 goal 或投影缺失时组件不渲染（返回 null），不影响任何功能；
 * 卸载本插件即完全恢复。
 */
window.__ModuleLoader__.load({
	id: "@dsh-local/loop-cost",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let { jsx: _jsx, jsxs: _jsxs } = require("react/jsx-runtime");
		var _react = require("react");

		// ── 计价（每百万 tokens 元；DeepSeek 调价时同步更新，同 005-deepseek.md）──
		var PRICE = {
			inputUncached: 1.5, // 输入·缓存未命中
			inputCached: 0.05, // 输入·缓存命中
			output: 4.5, // 输出
			peakMultiplier: 2 // 高峰时段（北京时间 09-12 / 14-18）×2
		};

		function beijingHour() {
			try {
				return Number(new Intl.DateTimeFormat("zh-CN", { hour: "numeric", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date()));
			} catch (e) {
				return new Date().getHours();
			}
		}

		function isPeak() {
			// 政策（2026-08-23 起）：周末全天按低谷价；工作日高峰 09-12 / 14-18（北京时间）×2
			try {
				var wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Shanghai" }).format(new Date());
				if (wd === "Sat" || wd === "Sun") return false;
			} catch (e) { /* fall through to hour check */ }
			var h = beijingHour();
			return (h >= 9 && h < 12) || (h >= 14 && h < 18);
		}

		/** 金额自适应格式化（与 cost-gauge 一致，保证宽度恒定）。 */
		function formatCost(c) {
			if (c >= 10000) return "¥" + (c / 10000).toFixed(2) + "万";
			if (c >= 1000) return "¥" + (c / 1000).toFixed(2) + "k";
			if (c >= 100) return "¥" + c.toFixed(1);
			return "¥" + c.toFixed(2);
		}

		/** 会话累计 token → 金额估算（tokenUsage 投影：totals 扁平或嵌套皆可）。 */
		function costOf(usage) {
			if (!usage) return 0;
			var t = usage.totals || usage;
			var mult = isPeak() ? PRICE.peakMultiplier : 1;
			return (
				((t.uncachedInputTokens || 0) * PRICE.inputUncached +
					(t.cacheReadTokens || 0) * PRICE.inputCached +
					(t.outputTokens || 0) * PRICE.output) /
					1e6
			) * mult;
		}

		function tokensOf(usage) {
			if (!usage) return { u: 0, c: 0, o: 0 };
			var t = usage.totals || usage;
			return {
				u: t.uncachedInputTokens || 0,
				c: t.cacheReadTokens || 0,
				o: t.outputTokens || 0
			};
		}

		/** 显示 goal 轮次 + 会话累计花费（tooltip 含明细）。 */
		function LoopCost(props) {
			var useProjection = props.useProjection;
			var goal = useProjection("goal");
			var usage = useProjection("tokenUsage");
			var cost = costOf(usage);
			var tok = tokensOf(usage);
			var g = goal && goal.phase ? goal : null;
			if (!g) return null; // 无 goal：不渲染（零占用）

			var phaseLabel = g.phase === "active" ? "进行中" : g.phase === "paused" ? "已暂停" : g.phase === "blocked" ? "已阻塞" : g.phase;
			var tip =
				"goal " + phaseLabel +
				" · " + g.roundsStarted + "/" + g.maxGoalRounds + " 轮" +
				"\n会话累计（token 估算）: " + formatCost(cost) +
				" (" + (isPeak() ? "高峰 ×2" : "空闲 ×1") + ")" +
				"\n输入未命中 " + tok.u + " · 缓存命中 " + tok.c + " · 输出 " + tok.o + " tokens" +
				"\n速率: 输入 ¥" + PRICE.inputUncached + "/M · 缓存 ¥" + PRICE.inputCached + "/M · 输出 ¥" + PRICE.output + "/M";

			return _jsxs("div", {
				title: tip,
				style: { display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 46, cursor: "default", padding: "0 2px" },
				children: [
					_jsx("span", {
						style: { fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
						children: "⏱ " + g.roundsStarted + "/" + g.maxGoalRounds + " 轮"
					}),
					_jsx("span", {
						style: { fontSize: 9, opacity: 0.6, whiteSpace: "nowrap" },
						children: formatCost(cost)
					})
				]
			});
		}

		/** Client plugin body: mount in the session header utilities slot（cost-gauge 之后）。 */
		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "loop-cost",
				order: 60
			}, LoopCost));
		}

		// Services this plugin requires from the Cordis client runtime.
		// MUST be declared, or accessing ctx.slots throws
		// "cannot get property slots without inject".
		var inject = ["slots"];

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
