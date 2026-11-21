import { CodeOutlined } from '@ant-design/icons';
import { useEffect, useRef } from 'react';
import type { Ref } from 'react';
import type { DshCommand } from './assistantAcp';

export type ComposerCommand = Pick<DshCommand, 'name' | 'description' | 'hint' | 'reason' | 'executable'> & { native?: boolean };
export const composerCommandListId = 'somnus-composer-commands';
export function composerCommandRowId(index: number) { return composerCommandListId + '-' + index; }

export function ComposerCommands({ commands, selected, loading, menuRef, onChoose, onPoint }: {
  commands: ComposerCommand[]; selected: number; loading: boolean;
  menuRef: Ref<HTMLDivElement>;
  onChoose: (command: ComposerCommand) => void; onPoint: (index: number) => void;
}) {
  const activeRow = useRef<HTMLButtonElement>(null);
  useEffect(() => { activeRow.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  return <div ref={menuRef} className="composer-command-menu">
    <div id={composerCommandListId} role="listbox" aria-label="会话命令">
      {commands.map((command, index) => <button type="button" key={command.name} role="option" tabIndex={-1}
        id={composerCommandRowId(index)} ref={index === selected ? activeRow : undefined}
        aria-selected={index === selected} aria-disabled={!command.executable}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => onPoint(index)}
        onClick={() => { if (command.executable) onChoose(command); }}>
        <CodeOutlined aria-hidden="true" />
        <span><strong>/{command.name}</strong><small>{command.reason || command.description}</small></span>
        {command.hint && <kbd>{command.hint}</kbd>}
      </button>)}
    </div>
    {loading && <p role="status">正在读取原生命令…</p>}
    {!loading && !commands.length && <p role="status">没有匹配的命令</p>}
  </div>;
}
