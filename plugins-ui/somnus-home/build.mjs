/**
 * 用仓库里已装好的 esbuild 构建 DSH 客户端模块（不 pnpm install、不联网）。
 *
 * 产物：dist/client.js
 *   window.__ModuleLoader__.load({ id: '@local/somnus-home-plugin', factory(require) { ... } })
 *   内部是 esbuild 的 CJS 产物原样包裹；宿主模块表提供 react（external: ['react']），
 *   echarts 从 page_design/frontend/node_modules 解析后打进 bundle。
 *
 * 用法：node build.mjs
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ID = '@local/somnus-home-plugin'
const require = createRequire(import.meta.url)
// plugins-ui/somnus-home/build.mjs → 仓库根目录
const pluginRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(pluginRoot, '..', '..')
const frontendNodeModules = join(repoRoot, 'page_design', 'frontend', 'node_modules')

const esbuild = require(join(frontendNodeModules, 'esbuild'))

const entry = join(pluginRoot, 'src', 'entry.tsx')
const outDir = join(pluginRoot, 'dist')
const outFile = join(outDir, 'client.js')

console.log(`[somnus-home-plugin] entry: ${entry}`)
console.log(`[somnus-home-plugin] esbuild: ${esbuild.version}`)
console.log(`[somnus-home-plugin] node paths: ${frontendNodeModules}`)

const result = await esbuild.build({
  entryPoints: [entry],
  absWorkingDir: pluginRoot,
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  // 宿主只提供 react，没有 JSX runtime：经典转换 → React.createElement。
  jsx: 'transform',
  external: ['react'],
  // CSS 当字符串导入，由 entry.tsx 自己注入 <style>。
  loader: { '.css': 'text' },
  nodePaths: [frontendNodeModules],
  minify: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})

if (result.errors.length > 0) {
  for (const error of result.errors) console.error(error.text)
  process.exit(1)
}
if (result.outputFiles === undefined || result.outputFiles.length !== 1) {
  throw new Error(`expected exactly one output file, got ${result.outputFiles?.length ?? 0}`)
}

const bundled = result.outputFiles[0].text
const indented = bundled.split('\n').map(line => (line === '' ? '' : `    ${line}`)).join('\n')

const wrapped = `/**
 * Somnus 主页插件客户端模块。
 * 由 build.mjs 自动生成，请勿手改；重新构建：node build.mjs
 *
 * 渲染代码来自仓库 plugins-ui/somnus-home/src：
 *   LegacyWorkbench → LegacyHomeDashboard → LegacyChart
 */
window.__ModuleLoader__.load({
  id: '${PACKAGE_ID}',
  factory(require) {
    var React = require('react');
    var module = { exports: {} };
    var exports = module.exports;
${indented}
    return module.exports;
  },
});
`

await mkdir(outDir, { recursive: true })
await writeFile(outFile, wrapped, 'utf8')

const bytes = Buffer.byteLength(wrapped, 'utf8')
console.log(`[somnus-home-plugin] wrote ${outFile} (${bytes} bytes, ${(bytes / 1024).toFixed(1)} KiB)`)
