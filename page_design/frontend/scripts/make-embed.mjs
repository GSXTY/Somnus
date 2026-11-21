import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function makeEmbed(output) {
  const html = await readFile(join(output, 'index.html'), 'utf8')
  const marker = '</head>'
  if (!html.includes(marker)) throw new Error('index.html has no </head>')
  const embed = html.replace(marker, `  <script>document.documentElement.dataset.somnusEmbed = '1'; document.documentElement.dataset.visualTheme = 'codex';</script>
  <style>
    html, body, #root { height: 100%; margin: 0; overflow: hidden; background: var(--shell-bg, #f4f8f6); }
    .global-header.ant-layout-header, .navigation.ant-layout-sider { display: none !important; }
    .workbench.ant-layout, .workspace-shell-body.ant-layout { height: 100vh; min-height: 0; }
    .workspace-content.ant-layout-content { padding: 18px 20px; height: 100vh; overflow: auto; }
    .workspace-panel { height: auto; }
    .analysis-workspace-panel, .deep-analysis-workspace-panel { height: calc(100vh - 36px) !important; }
    .analysis-workspace-panel { padding: 0 !important; overflow: hidden; }
    .analysis-workspace-frame { width: 100%; height: 100%; border: 0; }
  </style>
${marker}`)
  await writeFile(join(output, 'embed.html'), embed)
}
