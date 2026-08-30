/**
 * @dsh-local/cost-gauge — host (node) half.
 *
 * Exposes GET /api/deepseek-balance: resolves the DEEPSEEK_API_KEY credential
 * through the credentials seam (never exposing it to the browser), queries
 * the DeepSeek platform balance endpoint, and returns the JSON with a short
 * in-process cache. The browser half polls this route to show the live
 * account balance next to the session spend gauge.
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials'

const name = '@dsh-local/cost-gauge'
const inject = ['webServer', 'credentials']
const BALANCE_CACHE_MS = 30_000

function sendJson(res, obj, status = 200) {
	const body = JSON.stringify(obj)
	res.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Cache-Control': 'no-store'
	})
	res.end(body)
}

function apply(ctx) {
	let cache = null // { at, data }
	ctx.effect(() => {
		const disposeRoute = ctx.webServer.register({
			kind: 'exact',
			path: '/api/deepseek-balance',
			handler: async (_req, res) => {
				try {
					if (cache !== null && Date.now() - cache.at < BALANCE_CACHE_MS) {
						return sendJson(res, cache.data)
					}
					const hit = await ctx.credentials.resolve(credentialRef('DEEPSEEK_API_KEY'))
					if (!hit || !hit.value) {
						return sendJson(res, { ok: false, error: 'DEEPSEEK_API_KEY not configured' }, 503)
					}
					const upstream = await fetch('https://api.deepseek.com/user/balance', {
						headers: { Authorization: 'Bearer ' + hit.value },
						signal: AbortSignal.timeout(10_000)
					})
					const data = await upstream.json()
					cache = { at: Date.now(), data: { ok: upstream.ok, ...data } }
					return sendJson(res, cache.data)
				} catch (err) {
					return sendJson(res, { ok: false, error: String(err && err.message ? err.message : err) }, 502)
				}
			}
		})
		return disposeRoute
	}, 'cost-gauge: balance route')
}

export { name, inject, apply }
