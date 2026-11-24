import { defineConfig } from 'vite';
import { cachePathFromUrl } from '../../desktop/storage-paths.mjs';
import { frontendBuildManifest } from './build-manifest.mjs';

/** Vite config runs in Node, but this project has no Node type globals in scope. */
function noMinifyBuild(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.SOMNUS_NO_MINIFY === '1';
}

export default defineConfig({
  base: '/workbench-assets/',
  cacheDir: cachePathFromUrl(new URL('../../', import.meta.url), 'frontend', 'vite'),
  plugins: [frontendBuildManifest()],
  build: {
    outDir: '../web', emptyOutDir: true, assetsDir: 'assets',
    // esbuild writes the final chunk transpile/minify result to a temp file and
    // then deletes it; on this host the delete fails with EACCES ("Access is
    // denied") and the whole build aborts. Two consequences:
    //   - target stays 'esnext' so the chunk-level esbuild transpile pass is
    //     skipped entirely (the app only ships inside Electron 44 / modern
    //     Chromium, so downleveling was never needed);
    //   - minification runs through terser, which is pure JS and writes no
    //     temp files, so compression no longer depends on that delete.
    // SOMNUS_NO_MINIFY=1 remains a pure escape hatch: no compression at all.
    target: 'esnext' as const,
    ...(noMinifyBuild()
      ? { minify: false as const }
      : { minify: 'terser' as const, terserOptions: { compress: { passes: 2 }, format: { comments: false } } }),
    rollupOptions: {
      onwarn(warning, warn) {
        // AntD's React Server Component directives have no effect in this browser-only SPA.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        warn(warning);
      },
      output: {
        manualChunks: { charts: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'], ui: ['antd', '@ant-design/icons'] },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  server: { proxy: { '/api': 'http://127.0.0.1:8765', '/events': 'http://127.0.0.1:8765' } },
});

