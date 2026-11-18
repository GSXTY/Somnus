import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBlocks, parseInline } from '../src/markdown.mjs';
import { highlightCode } from '../src/codeHighlight.mjs';

test('local code highlighting preserves exact text and separates strings from comments', () => {
  const code = 'const url = "https://example.com"; // note\nreturn 42;';
  const tokens = highlightCode(code, 'ts');
  assert.equal(tokens.map(token => token.text).join(''), code);
  assert.deepEqual(tokens.filter(token => token.type).map(token => [token.type, token.text]), [
    ['keyword', 'const'], ['string', '"https://example.com"'], ['comment', '// note'], ['keyword', 'return'], ['number', '42'],
  ]);
  assert.deepEqual(highlightCode(code, 'unknown-language'), [{ text: code }]);
});

test('inline tokens cover bold, code and https links', () => {
  assert.deepEqual(parseInline('**粗** 和 `code` 和 [链接](https://example.com)'), [
    { type: 'strong', text: '粗' },
    { type: 'text', text: ' 和 ' },
    { type: 'code', text: 'code' },
    { type: 'text', text: ' 和 ' },
    { type: 'link', text: '链接', href: 'https://example.com' },
  ]);
});

test('unsafe link targets stay plain text', () => {
  const tokens = parseInline('[x](javascript:alert(1))');
  assert.equal(tokens[0].type, 'link');
  assert.equal(tokens[0].href, 'javascript:alert(1');
  assert.ok(!/^https?:/i.test(tokens[0].href));
});

test('blocks split paragraphs, tables, lists, code and quotes', () => {
  const fence = '```';
  const source = [
    '**低通气** 指气流下降。',
    '',
    '| 呼吸暂停 | 低通气 |',
    '| --- | --- |',
    '| 完全停止 | 下降 30% |',
    '',
    '### 判定要点',
    '- 持续 ≥ 10 秒',
    '- 血氧下降 3%',
    '',
    `${fence}json`,
    '{"a": 1}',
    fence,
    '',
    '> 引用一行',
  ].join('\n');
  const blocks = parseBlocks(source);
  assert.deepEqual(blocks.map(block => block.type), ['paragraph', 'table', 'heading', 'list', 'code', 'quote']);
  assert.deepEqual(blocks[1].head, ['呼吸暂停', '低通气']);
  assert.deepEqual(blocks[1].rows, [['完全停止', '下降 30%']]);
  assert.equal(blocks[2].level, 3);
  assert.deepEqual(blocks[3].items, ['持续 ≥ 10 秒', '血氧下降 3%']);
  assert.equal(blocks[4].lang, 'json');
  assert.equal(blocks[4].text, '{"a": 1}');
});

test('unclosed formatting degrades to text instead of throwing', () => {
  const blocks = parseBlocks('**未闭合的粗体');
  assert.equal(blocks[0].type, 'paragraph');
  assert.deepEqual(parseInline('**未闭合').map(token => token.type), ['text']);
});
