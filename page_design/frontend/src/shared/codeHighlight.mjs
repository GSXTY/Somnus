const aliases = new Map(Object.entries({
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'bash',
  shell: 'bash', zsh: 'bash', ps1: 'powershell', pwsh: 'powershell', yml: 'yaml', cs: 'csharp', 'c++': 'cpp', rs: 'rust',
}));
const keywords = new Map(Object.entries({
  javascript: 'async await break case catch class const continue default delete do else export extends finally for from function if import in instanceof let new null of return static super switch this throw true false try typeof undefined var void while yield',
  typescript: 'abstract any as boolean declare enum implements infer interface is keyof never number private protected public readonly satisfies string type unknown',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
  bash: 'case do done elif else esac fi for function if in local return select then until while export set',
  powershell: 'begin break catch class continue data do dynamicparam else elseif end enum exit filter finally for foreach from function if in param process return switch throw trap try until using while workflow',
  sql: 'add all alter and as asc between by case count create cross delete desc distinct drop else end exists from full group having in index inner insert into is join left like limit not null offset on or order outer over right select set table then union update values view when where with',
  json: 'true false null',
  yaml: 'true false null yes no',
  c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while',
  cpp: 'alignas auto bool class concept constexpr consteval constinit delete false namespace new nullptr private protected public requires template this throw true using virtual',
  csharp: 'abstract as async await base bool class delegate enum event false foreach get interface internal is namespace new null override private protected public record sealed set static string struct this throw true using var virtual',
  java: 'abstract boolean class extends false final implements import interface native new null package private protected public record static super synchronize this throws true void',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while',
}));

const syntax = /(?<string>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(?<number>\b(?:0[xX][\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b)|(?<word>[$\p{L}_][$\p{L}\p{N}_-]*)/gu;
const hashComments = new Set(['python', 'bash', 'powershell', 'yaml']);
const cComments = new Set(['javascript', 'typescript', 'c', 'cpp', 'csharp', 'java', 'rust']);

export function highlightCode(text, language) {
  const lang = aliases.get(language.toLowerCase()) || language.toLowerCase();
  if (!keywords.has(lang) || text.length > 30000) return [{ text }];
  const rules = cComments.has(lang) ? '(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)|'
    : hashComments.has(lang) ? '(?<comment>#[^\\n]*)|' : lang === 'sql' ? '(?<comment>--[^\\n]*|/\\*[\\s\\S]*?\\*/)|' : '';
  const lexer = new RegExp(rules + syntax.source, syntax.flags);
  const family = lang === 'typescript' ? 'javascript' : ['java', 'cpp', 'csharp'].includes(lang) ? 'c' : '';
  const keywordSet = new Set([keywords.get(lang), keywords.get(family)].filter(Boolean).join(' ').split(' '));
  const parts = [];
  let end = 0;
  for (const token of text.matchAll(lexer)) {
    if (token.index > end) parts.push({ text: text.slice(end, token.index) });
    const { string, number, word, comment } = token.groups;
    const lookup = ['sql', 'powershell', 'yaml'].includes(lang) ? word?.toLowerCase() : word;
    const type = comment ? 'comment' : string ? 'string' : number ? 'number' : keywordSet.has(lookup) ? 'keyword' : undefined;
    parts.push({ text: token[0], type });
    end = token.index + token[0].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end) });
  return parts;
}
