import { useMemo } from 'react';
import { parseBlocks, parseInline } from './markdown.mjs';

type Token = { type: string; text: string; href?: string };
type Block = { type: string; level?: number; text?: string; lang?: string; ordered?: boolean; items?: string[]; head?: string[]; rows?: string[][] };

function safeHref(href: string | undefined): href is string {
  return typeof href === 'string' && (/^https?:\/\//i.test(href) || /^\/#deep-analysis\?task=[a-f0-9]{32}$/.test(href));
}

function Inline({ text }: { text: string }) {
  const tokens = useMemo(() => parseInline(text) as Token[], [text]);
  return <>{tokens.map((token, index) => {
    if (token.type === 'code') return <code key={index}>{token.text}</code>;
    if (token.type === 'strong') return <strong key={index}>{token.text}</strong>;
    if (token.type === 'em') return <em key={index}>{token.text}</em>;
    if (token.type === 'link') return safeHref(token.href)
      ? <a key={index} href={token.href.startsWith('/') ? token.href.slice(1) : token.href} target={token.href.startsWith('/') ? undefined : '_blank'} rel="noopener noreferrer">{token.text}</a>
      : <span key={index}>{token.text}</span>;
    return <span key={index}>{token.text}</span>;
  })}</>;
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

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text) as Block[], [text]);
  if (!blocks.length) return null;
  return <div className="assistant-markdown">{blocks.map((block, index) => {
    if (block.type === 'heading') {
      return <Heading key={index} level={Math.min(Math.max(block.level || 1, 1), 6)} text={block.text || ''} />;
    }
    if (block.type === 'code') {
      return <pre key={index} className="assistant-code"><code>{block.text}</code></pre>;
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
  })}</div>;
}
