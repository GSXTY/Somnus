/**
 * Host 半段：主页完全由客户端模块 `dist/client.js` 渲染。
 *
 * Host 侧不读取 Somnus 数据、不注册工具、不提供服务，只作为 bundle 清单所需
 * 的插件入口存在（`export function apply() {}`）。页面数据由客户端模块沿用
 * `window.somnusApi` 桥请求本机 `/api/workbench`。
 */
export function apply() {}
