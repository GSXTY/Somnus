import { ArrowRightOutlined } from '@ant-design/icons';
import type { WorkspaceTool } from './workspacePlugins';

export function Plugins({ tools, onOpen }: { tools: WorkspaceTool[]; onOpen: (tool: WorkspaceTool) => void }) {
  return <div className="plugins-page">
    <section aria-labelledby="tools-heading">
      <h1 id="tools-heading" className="tools-heading">工具区</h1>
      <div className="builtin-tools-grid">
        {tools.map(tool => <button type="button" className="builtin-tool" key={tool.key} onClick={() => onOpen(tool)}>
          <span><strong>{tool.label}</strong><small>{tool.hint}</small></span><ArrowRightOutlined aria-hidden="true" />
        </button>)}
      </div>
    </section>
  </div>;
}
