/**
 * @dsh-local/cost-gauge — browser half.
 *
 * A clock-style gauge mounted in the conversation header's utilities slot
 * (right side of the session header). It reads the host-computed "tokenUsage"
 * session projection (uncachedInputTokens / cacheReadTokens / outputTokens)
 * and prices it with DeepSeek V4 Flash rates (CNY per 1M tokens, effective
 * 2026-08-17): uncached input ¥1.5, cached input ¥0.05, output ¥4.5, and a
 * ×2 peak-hour multiplier (09:00–12:00 / 14:00–18:00 Beijing). The gauge is
 * event-driven: every provider usage frame re-renders it, so it stays live
 * with no polling.
 */
window.__ModuleLoader__.load({
	id: "@dsh-local/cost-gauge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let { jsx: _jsx, jsxs: _jsxs } = require("react/jsx-runtime");

		// ── Pricing (CNY per 1M tokens; edit when DeepSeek changes rates) ──
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
			// 政策（2026-08-23 起）：周末（周六/周日）全天统一按低谷价，
			// 不区分峰谷；工作日高峰 09-12 / 14-18（北京时间）价格 ×2。
			try {
				var wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Shanghai" }).format(new Date());
				if (wd === "Sat" || wd === "Sun") return false;
			} catch (e) { /* fall through to hour check */ }
			var h = beijingHour();
			return (h >= 9 && h < 12) || (h >= 14 && h < 18);
		}

		/**
		 * 金额自适应格式化：数字越大自动换单位/降精度，保证仪表宽度恒定，
		 * 避免累计消耗变大后撑爆 header 布局。
		 *   < ¥100    → ¥xx.xx（两位小数）
		 *   < ¥1000   → ¥xxx.x（一位小数）
		 *   < ¥10000  → ¥x.xxk
		 *   ≥ ¥10000  → ¥x.xx万
		 */
		function formatCost(c) {
			if (c >= 10000) return "¥" + (c / 10000).toFixed(2) + "万";
			if (c >= 1000) return "¥" + (c / 1000).toFixed(2) + "k";
			if (c >= 100) return "¥" + c.toFixed(1);
			return "¥" + c.toFixed(2);
		}

		function costOf(usage) {
			if (!usage) return 0;
			// tokenUsage projection shape: { totals: {uncachedInputTokens,
			// cacheReadTokens, outputTokens, cacheWriteTokens}, last: {...} }.
			var t = usage.totals || usage;
			var mult = isPeak() ? PRICE.peakMultiplier : 1;
			return (
				((t.uncachedInputTokens || 0) * PRICE.inputUncached +
					(t.cacheReadTokens || 0) * PRICE.inputCached +
					(t.outputTokens || 0) * PRICE.output) /
					1e6
			) * mult;
		}

		/**
		 * Clock-style gauge. `props.useProjection` is the session-scoped
		 * projection hook provided by the slot kit.
		 */
		var _react = require("react");
		var useState = _react.useState, useEffect = _react.useEffect;
		var BALANCE_POLL_MS = 60_000;

		function CostGauge(props) {
			var useProjection = props.useProjection;
			var usage = useProjection("tokenUsage");
			var sessionCost = costOf(usage); // token-meter 估算（仅参考）
			// Live account balance from the host route (node half), polled.
			var balanceState = useState(null);
			var balance = balanceState[0];
			// ── 周期语义：每次充值后重新开始计算消耗与百分比 ──
			// 周期状态 { topUp: 本周期充值额, b0: 周期起点余额 }，localStorage 持久化。
			// 充值自动检测：余额只降不升，发现跳升(>+1)即判定充值 → 重置周期。
			// b0 === null 时（首次/无历史）退化为近似：topUp − balance。
			var DEFAULT_TOP_UP = 100; // 仅在无周期状态时使用的默认值（可随用户告知更新）
			var WARN_RATIO = 0.9; // ≥90% 橙色预警：余额不足 10%
			var RECHARGE_RATIO = 0.99; // ≥99% 红色提醒：请充值
			var CYCLE_KEY = "costGaugeCycle.v1";

			function loadCycle() {
				try {
					var raw = localStorage.getItem(CYCLE_KEY);
					if (raw) {
						var s = JSON.parse(raw);
						if (typeof s.topUp === "number" && (s.b0 === null || typeof s.b0 === "number")) return s;
					}
				} catch (e) { /* fall through */ }
				return null;
			}
			function saveCycle(s) {
				try { localStorage.setItem(CYCLE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
			}

			var cycleState = useState(loadCycle() || { topUp: DEFAULT_TOP_UP, b0: null });
			var cycle = cycleState[0];
			var prevBalanceState = useState(null);
			var rechargeFlashState = useState(false);
			var prevBalance = prevBalanceState[0];
			useEffect(function () {
				var alive = true;
				function load() {
					fetch("/api/deepseek-balance")
						.then(function (r) { return r.json(); })
						.then(function (d) {
							if (!alive) return;
							if (d && d.balance_infos && d.balance_infos.length > 0) {
								var bal = Number(d.balance_infos[0].total_balance);
								// 充值检测：余额跳升（正常只降不升）
								if (prevBalanceState[0] !== null && bal > prevBalanceState[0] + 1) {
									var newCycle = { topUp: bal - prevBalanceState[0], b0: bal };
									cycleState[1](newCycle);
									saveCycle(newCycle);
									rechargeFlashState[1](true);
								} else if (prevBalanceState[0] !== null && rechargeFlashState[0]) {
									rechargeFlashState[1](false); // 跳升后的下一次轮询清除提示
								}
								prevBalanceState[1](bal);
								balanceState[1](bal);
							} else if (d && d.error) {
								balanceState[1](null);
							}
						})
						.catch(function () { /* keep last value */ });
				}
				load();
				var timer = setInterval(load, BALANCE_POLL_MS);
				return function () { alive = false; clearInterval(timer); };
			}, []);
			// 周期消耗 = 起点余额 − 当前余额（充值后归零重计）；无起点时退化为 充值额 − 余额
			var spent = balance !== null && balance > 0
				? (cycle.b0 !== null ? Math.max(0, cycle.b0 - balance) : Math.max(0, cycle.topUp - balance))
				: null;
			var displayCost = spent !== null ? spent : sessionCost;
			var ratio = spent !== null ? Math.min(spent / cycle.topUp, 1) : Math.min(sessionCost / cycle.topUp, 1);
			var recharge = ratio >= RECHARGE_RATIO;
			var warn = !recharge && ratio >= WARN_RATIO;
			var tipColor = recharge ? "#ff3b3b" : warn ? "#ff9f43" : "#4f8cff";
			var cx = 32, cy = 34, R = 24;
			// Dial arc geometry (left end → right end), dash-offset reveals spend.
			var fullArc = "M " + (cx - R) + " " + cy + " A " + R + " " + R + " 0 0 1 " + (cx + R) + " " + cy;
			var arcLen = Math.PI * R;
			var ticks = [];
			for (var i = 0; i <= 5; i++) {
				var a = Math.PI - (Math.PI / 5) * i;
				var x1 = cx + (R + 2) * Math.cos(a), y1 = cy - (R + 2) * Math.sin(a);
				var x2 = cx + (R + 6) * Math.cos(a), y2 = cy - (R + 6) * Math.sin(a);
				ticks.push(_jsx("line", { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), stroke: "currentColor", strokeOpacity: 0.45, strokeWidth: 1.5, strokeLinecap: "round" }, "t" + i));
			}
			// Needle: 0 at the left end, 180° at the right end (clockwise).
			var needleDeg = -180 + 180 * ratio;
			var t = usage ? (usage.totals || usage) : null;
			var alertLine = recharge
				? "⚠️ 本周期已消耗 99%+，请充值！（充值后自动重置周期）"
				: warn
					? "⚠️ 本周期余额不足 10%，请准备充值"
					: null;
			var cycleLine = cycle.b0 !== null
				? "本周期: 充值 ¥" + cycle.topUp.toFixed(0) + "，起点余额 ¥" + cycle.b0.toFixed(2) + "，已耗 ¥" + (spent !== null ? spent.toFixed(2) : "0.00")
				: "当前按默认充值 ¥" + cycle.topUp + " 近似计算（检测到充值后自动重置）";
			var detail = [
				spent !== null ? "本周期已消耗: ¥" + spent.toFixed(2) : "已消耗: ¥" + sessionCost.toFixed(2) + "（余额读取中）",
				balance !== null ? "账号余额: ¥" + balance.toFixed(2) + "（开放平台实时）" : "账号余额: 读取中…",
				"指针: 本周期已用 " + Math.round(ratio * 100) + "%",
				cycleLine,
				rechargeFlashState[0] ? "🎉 检测到充值，周期已自动重置" : "",
				alertLine !== null ? alertLine : "",
				"── 本会话估算（token-meter，仅供参考）──",
				"本会话: ¥" + sessionCost.toFixed(2),
				"输入(未命中): " + (t ? t.uncachedInputTokens : 0) + " tokens",
				"输入(缓存命中): " + (t ? t.cacheReadTokens : 0) + " tokens",
				"输出: " + (t ? t.outputTokens : 0) + " tokens",
				(isPeak() ? "⏰ 当前高峰时段（全部按 ×2 计价，近似）" : "当前空闲时段（按 ×1 计价）"),
				"速率: 输入 ¥" + PRICE.inputUncached + "/M · 缓存 ¥" + PRICE.inputCached + "/M · 输出 ¥" + PRICE.output + "/M"
			].join("\n");
			return _jsxs("div", {
				title: detail,
				style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					cursor: "default",
					padding: "2px 6px",
					borderRadius: 8,
					color: "inherit",
					userSelect: "none",
					whiteSpace: "nowrap"
				},
				children: [
					_jsxs("svg", {
						width: 44,
						height: 28,
						viewBox: "0 0 64 40",
						"aria-label": "API 消耗金额",
						children: [
							_jsx("path", { d: fullArc, fill: "none", stroke: "currentColor", strokeOpacity: 0.18, strokeWidth: 3, strokeLinecap: "round" }),
							_jsx("path", {
								d: fullArc,
								fill: "none",
								stroke: tipColor,
								strokeWidth: 3,
								strokeLinecap: "round",
								strokeDasharray: arcLen,
								strokeDashoffset: arcLen * (1 - ratio),
								style: { transition: "stroke-dashoffset 0.5s ease" }
							}),
							ticks,
							_jsx("g", {
								transform: "rotate(" + needleDeg + " " + cx + " " + cy + ")",
								children: _jsx("line", { x1: cx, y1: cy, x2: cx + R - 2, y2: cy, stroke: tipColor, strokeWidth: 2.5, strokeLinecap: "round" })
							}),
							_jsx("circle", { cx: cx, cy: cy, r: 2.5, fill: tipColor })
						]
					}),
					_jsxs("div", {
						style: { display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 52 },
						children: [
							_jsx("span", { style: { fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: tipColor, whiteSpace: "nowrap" }, children: formatCost(displayCost) }),
							_jsx("span", {
								style: { fontSize: 9, opacity: 0.6, color: recharge ? "#ff3b3b" : "inherit", fontWeight: recharge ? 700 : "inherit", whiteSpace: "nowrap" },
								children: recharge ? "⚠️ 请充值" : (warn ? "⚠️ 余额不足" : (spent !== null ? "已耗 " + Math.round(ratio * 100) + "%" : (balance === null ? "API 消耗" : "已耗 0%")))
							})
						]
					})
				]
			});
		}

		/**
		 * Client plugin body: mount the gauge in the session header's
		 * utilities slot (the rightmost header area).
		 */
		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "cost-gauge",
				order: 50
			}, CostGauge));
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
