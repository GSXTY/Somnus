const assert = require('node:assert/strict');
const test = require('node:test');
const { readDetail, readToolDetail } = require('./acp-dsh-subagent-detail.cjs');

test('reads one durable child scope and omits internal and out-of-turn events', async () => {
  const packet = (seq, role, text, type = 'assistant/message') => ({
    event: { seq, type, data: { message: { role, content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text }] } } },
  });
  const calls = [];
  const result = await readDetail(async (method, args) => {
    assert.equal(method, 'events');
    calls.push(args);
    return args.beforeSeq
      ? { hasMore: false, records: [packet(1, 'assistant', 'prior'), packet(4, 'assistant', 'first')] }
      : { hasMore: true, records: [packet(5, 'assistant', 'tool', 'tool/call'),
        packet(6, 'assistant', 'second'), packet(8, 'assistant', 'later')] };
  }, { sessionId: 'child', parentId: 'parent', mode: 'continuable', after: 3, through: 7,
    step: { title: 'Read project', status: 'completed' } });
  assert.deepEqual(calls[0].address, {
    kind: 'subagent', parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable',
  });
  assert.equal(calls[1].beforeSeq, 5);
  assert.deepEqual(result, { title: 'Read project', status: 'completed', truncated: false,
    messages: [{ role: 'assistant', text: 'first' }, { role: 'assistant', text: 'second' }],
    entries: [{ seq: 4, type: 'message', role: 'assistant', text: 'first' },
      { seq: 6, type: 'message', role: 'assistant', text: 'second' }] });
});

test('tool timeline is paged and does not expose raw arguments, results or credentials', async () => {
  const event = (seq, type, data) => ({ event: { seq, type, data } });
  const mock = async (_method, { beforeSeq = 13 }) => {
    const seq = beforeSeq - 1;
    const records = [seq === 12
      ? event(seq, 'tool/result', {
        message: { role: 'tool', toolCallId: 'call', isError: true, content: ['raw result'] },
        error: { code: 'PERMISSION_DENIED', reason: 'raw reason' },
      })
      : seq === 11 ? event(seq, 'tool/call', { callId: 'call', name: 'pwsh', arguments: 'raw args' })
        : event(seq, 'assistant/message', { message: { role: 'assistant', content: [
          { type: 'text', text: 'Bearer sample-secret-string' }, { type: 'reasoning', text: 'hidden thought' },
        ] } })];
    return { records, hasMore: seq > 1 };
  };
  const range = { sessionId: 'child', parentId: 'parent', mode: 'continuable', after: 0, through: 12,
    step: { title: 'Inspect project', status: 'completed' } };
  const result = await readDetail(mock, range);
  assert.equal(result.nextBeforeSeq, 7);
  assert.deepEqual(result.entries.slice(-2), [
    { seq: 11, type: 'tool', name: 'pwsh', status: 'running' },
    { seq: 12, type: 'tool', name: 'pwsh', status: 'failed', reason: '工具操作未获授权。' },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /raw |sample-secret|hidden thought/);
  const earlier = await readDetail(mock, range, result.nextBeforeSeq);
  assert.equal(earlier.entries.length, 6);
  assert.equal(earlier.entries.at(-1).seq, 6);
  assert.equal(earlier.nextBeforeSeq, undefined);
  assert.equal(await readDetail(mock, range, 14), null);
});

test('tool payload is retrieved within the verified child range and pages redacted public text', async () => {
  const result = 'a'.repeat(16_001) + 'tail';
  const events = [
    { seq: 2, type: 'tool/call', data: { callId: 'call', name: 'outside', arguments: 'unrelated' } },
    { seq: 4, type: 'tool/call', data: { callId: 'call', name: 'pwsh',
      arguments: '{"command":"hello","password":"fixture-secret","authorization":"unexpected secret"}' } },
    { seq: 5, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'not a tool' }] } } },
    { seq: 7, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'call', isError: true,
      content: [{ type: 'text', text: result }, { type: 'reasoning', text: 'private reasoning' }] },
      meta: { private: 'sensitive meta' } } },
  ];
  const range = { sessionId: 'child', parentId: 'parent', mode: 'continuable', after: 3, through: 8 };
  const call = async (method, { address, throughSeq, beforeSeq }) => {
    assert.equal(method, 'events');
    assert.equal(address.childSessionId, 'child');
    return { records: events.filter(event => event.seq <= throughSeq && event.seq < (beforeSeq ?? Infinity))
      .map(event => ({ event })) };
  };
  assert.equal(await readToolDetail(call, range, 2), null);
  assert.equal(await readToolDetail(call, range, 5), null);
  const first = await readToolDetail(call, range, 7);
  assert.equal(first.status, 'failed');
  assert.equal(first.name, 'pwsh');
  assert.equal(first.nextOffset, 16_000);
  assert.equal(first.truncated, true);
  assert.match(first.arguments, /hello/);
  assert.doesNotMatch(JSON.stringify(first), /fixture-secret|unexpected secret|private reasoning|sensitive meta/);
  const rest = await readToolDetail(call, range, 4, first.nextOffset);
  assert.equal(rest.status, 'failed');
  assert.equal(first.output + rest.output, result);
  assert.equal(rest.nextOffset, undefined);
});
