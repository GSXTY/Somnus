/**
 * 用仓库里已装好的 esbuild 构建 DSH 客户端模块（不 pnpm install、不联网）。
 *
 * 产物：dist/client.js
 *   window.__ModuleLoader__.load({ id: '@local/somnus-tools-probe', factory(require) { ... } })
 *   内部是 esbuild 的 CJS 产物原样包裹；宿主模块表提供 react（external: ['react']），
 *   antd / @ant-design/icons 从 page_design/frontend/node_modules 解析后打进 bundle；react 与 react-dom 由宿主模块表提供（external），避免出现第二份 React DOM。
 *
 * 与内置工具页构建的对应关系（desktop/dsh_next/client/overlay.mjs）：
 *   - 波形子页面的 `?somnus-native` 资源导入，复用内置构建用的同一个 esbuild 插件
 *     （desktop/dsh_next/client/waveform-build.mjs），保证 viewer.js / annotation-model.js
 *     的补丁与资源内联方式与内置版完全一致；
 *   - .css 用 `text` loader 变成字符串，由 src/entry.tsx 自己注入 <style>
 *     （内置版是打进客户端 CSS 文件，最终规则相同）。
 *
 * 用法：在插件目录内 node build.mjs
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_ID = '@local/somnus-tools-probe'
const require = createRequire(import.meta.url)
// plugins-ui/tools-probe/build.mjs → 仓库根目录
const pluginRoot = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(pluginRoot, '..', '..')
const frontendNodeModules = join(repoRoot, 'page_design', 'frontend', 'node_modules')
const waveformPluginPath = join(repoRoot, 'desktop', 'dsh_next', 'client', 'waveform-build.mjs')

const esbuild = require(join(frontendNodeModules, 'esbuild'))
// 复用内置构建对 event_detection 资源（?somnus-native）的处理，避免两套实现漂移。
const { waveformBuildPlugin } = await import(pathToFileURL(waveformPluginPath).href)

const entry = join(pluginRoot, 'src', 'entry.tsx')
const outDir = join(pluginRoot, 'dist')
const outFile = join(outDir, 'client.js')

console.log(`[somnus-tools-probe] entry: ${entry}`)
console.log(`[somnus-tools-probe] esbuild: ${esbuild.version}`)
console.log(`[somnus-tools-probe] node paths: ${frontendNodeModules}`)
console.log(`[somnus-tools-probe] waveform plugin: ${waveformPluginPath}`)

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
  external: ['react', 'react-dom'],
  // CSS 当字符串导入，由 entry.tsx 自己注入 <style>。
  loader: { '.css': 'text' },
  // NativeWaveform 的 index.html / viewer.js / annotation-model.js / dashboard.css / events.css
  // 走 ?somnus-native 后缀，交给内置构建同一个插件处理。
  plugins: [waveformBuildPlugin],
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
 * Somnus 工具页对照插件客户端模块。
 * 由 build.mjs 自动生成，请勿手改；重新构建：node build.mjs
 *
 * 渲染代码就是原内置工具页源码（已从 desktop/dsh_next/client/ 移入 src/，由插件自带）：
 *   NativeTools → SqlQuery / DeepAnalysis / NativeWaveform
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
console.log(`[somnus-tools-probe] wrote ${outFile} (${bytes} bytes, ${(bytes / 1024).toFixed(1)} KiB)`)
