import { defineConfig } from 'vite';

export default defineConfig({
  base: '/workbench-assets/',
  build: {
    outDir: '../web', emptyOutDir: true, assetsDir: 'assets',
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
