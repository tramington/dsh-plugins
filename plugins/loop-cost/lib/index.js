/**
 * @dsh-local/loop-cost — 服务端占位入口（browser-half 语义）。
 *
 * 本插件的全部 UI 逻辑在 lib/client.js（browser half，经 dsh.client 元数据
 * 由 host 托管 bundle）。服务端只需满足 loader 契约，不执行任何逻辑：
 * - apply：空实现
 * - inject：必须为空数组（slots 是浏览器端服务，服务端声明会永远 pending 致 boot 失败）
 *
 * 崩溃安全：占位无任何副作用，卸载即恢复。
 */
export const name = '@dsh-local/loop-cost'
export const inject = []
export const apply = function () {}
