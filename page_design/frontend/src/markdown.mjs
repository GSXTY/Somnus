// Minimal Markdown parser for chat answers. No HTML is ever executed: every
// block returns plain text/tokens that React escapes, and links are limited to
// http(s) by the renderer.

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\s]+\))/g;

export function parseInline(text) {
  const value = String(text ?? '');
  const out = [];
  let last = 0;
  let match;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(value))) {
    if (match.index > last) out.push({ type: 'text', text: value.slice(last, match.index) });
    const token = match[0];
    if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) });
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](');
      out.push({ type: 'link', text: token.slice(1, split), href: token.slice(split + 2, -1) });
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push({ type: 'strong', text: token.slice(2, -2) });
    } else {
      out.push({ type: 'em', text: token.slice(1, -1) });
    }
    last = match.index + token.length;
  }
  if (last < value.length) out.push({ type: 'text', text: value.slice(last) });
  return out;
}

const splitRow = line => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(cell => cell.trim());
const isSeparator = line => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const LIST = /^\s{0,3}([-*+]|\d+[.)])\s+/;
const BLOCK_START = /^\s{0,3}(#{1,6}\s|```|>\s?|[-*+]\s|\d+[.)]\s)/;

export function parseBlocks(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^\s*```(\S*)\s*$/);
    if (fence) {
      const buffer = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) { buffer.push(lines[index]); index += 1; }
      index += 1;
      blocks.push({ type: 'code', lang: fence[1] || '', text: buffer.join('\n') });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '').trim() });
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isSeparator(lines[index + 1])) {
      const head = splitRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    const list = line.match(LIST);
    if (list) {
      const ordered = /\d/.test(list[1]);
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(LIST);
        if (!item || /\d/.test(item[1]) !== ordered) break;
        items.push(lines[index].replace(LIST, ''));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (/^\s{0,3}>\s?/.test(line)) {
      const buffer = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        buffer.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: buffer.join('\n') });
      continue;
    }

    const buffer = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !BLOCK_START.test(lines[index])
      && !(lines[index].includes('|') && index + 1 < lines.length && isSeparator(lines[index + 1]))) {
      buffer.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: buffer.join('\n') });
  }
  return blocks;
}
