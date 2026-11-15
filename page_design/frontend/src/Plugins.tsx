import { ArrowRightOutlined } from '@ant-design/icons';
import { builtInTools } from './navigation.mjs';

export function Plugins({ onOpen }: { onOpen: (view: string) => void }) {
  return <div className="plugins-page">
    <section aria-labelledby="tools-heading">
      <h1 id="tools-heading" className="tools-heading">工具区</h1>
      <div className="builtin-tools-grid">
        {builtInTools.map(tool => <button type="button" className="builtin-tool" key={tool.key} onClick={() => onOpen(tool.key)}>
          <span><strong>{tool.label}</strong><small>{tool.hint}</small></span><ArrowRightOutlined aria-hidden="true" />
        </button>)}
      </div>
    </section>
  </div>;
}
