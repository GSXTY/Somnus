import { createContext, useContext, useMemo, useState } from 'react';
import { CheckOutlined, CopyOutlined, ExportOutlined, MenuFoldOutlined } from '@ant-design/icons';
import { parseBlocks, parseInline } from './markdown.mjs';
import { highlightCode } from './codeHighlight.mjs';
import { copyText } from './clipboard';

type Token = { type: string; text: string; href?: string };
type Block = { type: string; level?: number; text?: string; lang?: string; ordered?: boolean; items?: string[]; head?: string[]; rows?: string[][] };
const ExternalLinkContext = createContext<((url: string) => void) | undefined>(undefined);

function safeHref(href: string | undefined): href is string {
  return typeof href === 'string' && (/^https?:\/\//i.test(href) || /^\/#deep-analysis\?task=[a-f0-9]{32}$/.test(href));
}

function Inline({ text }: { text: string }) {
  const tokens = useMemo(() => parseInline(text) as Token[], [text]);
  const openExternalLink = useContext(ExternalLinkContext);
  return <>{tokens.map((token, index) => {
    if (token.type === 'code') return <code key={index}>{token.text}</code>;
    if (token.type === 'strong') return <strong key={index}>{token.text}</strong>;
    if (token.type === 'em') return <em key={index}>{token.text}</em>;
    if (token.type === 'link') {
      if (!safeHref(token.href)) return <span key={index}>{token.text}</span>;
      const local = token.href.startsWith('/');
      const href = token.href;
      return <a key={index} href={local ? href.slice(1) : href} target={local ? undefined : '_blank'}
        title={local ? undefined : href} rel="noopener noreferrer" onClick={local || !openExternalLink ? undefined : event => {
          if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
          event.preventDefault();
          openExternalLink(href);
        }}>{token.text}{!local && <ExportOutlined aria-hidden="true" className="assistant-external-link-icon" />}</a>;
    }
    return <span key={index}>{token.text}</span>;
  })}</>;
}

function CodeBlock({ text, language }: { text: string; language: string }) {
  const [wrap, setWrap] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'done' | 'error'>('idle');
  const tokens = useMemo(() => highlightCode(text, language), [text, language]);
  async function copy() {
    try {
      await copyText(text);
      setCopyStatus('done');
    } catch { setCopyStatus('error'); }
  }
  return <figure className="assistant-code-block">
    <figcaption>
      <span>{language || '纯文本'}</span>
      <div>
        <button type="button" aria-label="自动换行" aria-pressed={wrap} title="自动换行" onClick={() => setWrap(value => !value)}>
          <MenuFoldOutlined aria-hidden="true" />
        </button>
        <button type="button" aria-label="复制代码" title="复制代码" onClick={() => void copy()}>
          {copyStatus === 'done' ? <CheckOutlined aria-hidden="true" /> : <CopyOutlined aria-hidden="true" />}
        </button>
      </div>
    </figcaption>
    <pre className="assistant-code" data-wrap={wrap} tabIndex={0}><code>{tokens.map((token, index) => token.type
      ? <span key={index} data-token={token.type}>{token.text}</span> : token.text)}</code></pre>
    {copyStatus !== 'idle' && <small role="status">{copyStatus === 'done' ? '已复制代码' : '无法访问剪贴板'}</small>}
  </figure>;
}

function Lines({ text }: { text: string }) {
  const parts = text.split('\n');
  return <>{parts.map((part, index) => <span key={index}>{index ? <br /> : null}<Inline text={part} /></span>)}</>;
}

function Heading({ level, text }: { level: number; text: string }) {
  const content = <Inline text={text} />;
  if (level <= 3) return <h3>{content}</h3>;
  if (level === 4) return <h4>{content}</h4>;
  if (level === 5) return <h5>{content}</h5>;
  return <h6>{content}</h6>;
}

export function Markdown({ text, onOpenExternalLink }: { text: string; onOpenExternalLink?: (url: string) => void }) {
  const blocks = useMemo(() => parseBlocks(text) as Block[], [text]);
  if (!blocks.length) return null;
  return <ExternalLinkContext.Provider value={onOpenExternalLink}><div className="assistant-markdown">{blocks.map((block, index) => {
    if (block.type === 'heading') {
      return <Heading key={index} level={Math.min(Math.max(block.level || 1, 1), 6)} text={block.text || ''} />;
    }
    if (block.type === 'code') {
      return <CodeBlock key={index} text={block.text || ''} language={block.lang || ''} />;
    }
    if (block.type === 'hr') return <hr key={index} />;
    if (block.type === 'quote') return <blockquote key={index}><Lines text={block.text || ''} /></blockquote>;
    if (block.type === 'list') {
      const items = block.items || [];
      return block.ordered
        ? <ol key={index}>{items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}</ol>
        : <ul key={index}>{items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}</ul>;
    }
    if (block.type === 'table') {
      const head = block.head || [];
      const rows = block.rows || [];
      return <div className="assistant-table-wrap" key={index}>
        <table>
          {head.length ? <thead><tr>{head.map((cell, cellIndex) => <th key={cellIndex}><Inline text={cell} /></th>)}</tr></thead> : null}
          <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><Inline text={cell} /></td>)}</tr>)}</tbody>
        </table>
      </div>;
    }
    return <p key={index}><Lines text={block.text || ''} /></p>;
  })}</div></ExternalLinkContext.Provider>;
}
