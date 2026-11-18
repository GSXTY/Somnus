const assert = require('node:assert/strict');
const test = require('node:test');
const { createDshPluginSettings } = require('./acp-dsh-plugin-settings.cjs');

test('scopes plugin forms to their exact active module and preserves hidden settings', async () => {
  const id = '@fixture/my-plugin';
  const schema = { uid: 1, refs: {
    1: { type: 'object', dict: { enabled: 2, apiKey: 3, style: 4, choices: 7, protectedGroup: 9 } },
    2: { type: 'boolean' },
    3: { type: 'string' },
    4: { type: 'union', list: [5, 6] },
    5: { type: 'const', value: 'short' },
    6: { type: 'const', value: 'long' },
    7: { type: 'array', inner: 8 },
    8: { type: 'object', dict: { label: 3, enabled: 2 } },
    9: { type: 'object', dict: { secret: 3 } },
  } };
  const row = { ns: 'fixture', autoGenerate: true, revision: 1, schema,
    value: { enabled: false, apiKey: 'inaccessible', style: 'short', choices: [{ label: 'Primary', enabled: true }],
      protectedGroup: { secret: 'inaccessible' } }, secrets: [{ path: ['apiKey'] }] };
  const account = { request: async (_host, method, params) => {
    if (method === 'pluginInventory/list') return { entries: [
      { entryId: 'include:fixture', moduleName: id, fiberPhase: 'active', enabled: true },
      { entryId: 'include:foreign', moduleName: '@fixture/foreign', fiberPhase: 'active', enabled: true },
    ] };
    if (method === 'settings/describe') return { writable: true, namespaces: [row, { ...row, ns: 'foreign' }] };
    assert.equal(method, 'settings/mutate');
    assert.deepEqual(params, { ns: 'fixture', expectedRevision: 1,
      ops: [{ op: 'set', path: ['style'], value: 'long' },
        { op: 'set', path: ['choices'], value: [{ label: 'Updated', enabled: false }] }] });
    return { ...row, revision: 2, value: { ...row.value, style: 'long' } };
  } };
  const api = createDshPluginSettings({
    webProfile: async () => ({ bundles: [id] }), settings: async () => ({}), account,
  });
  const validate = () => {};
  const value = await api.read(id, 'community', validate);
  assert.equal(value.writable, true);
  assert.deepEqual(value.sections.map(section => section.id), ['fixture']);
  assert.deepEqual(value.sections[0].fields.map(field => field.key), ['enabled', 'style', 'choices']);
  assert.equal(value.sections[0].fields[2].type, 'json');
  assert.deepEqual(value.sections[0].fields[1].options, ['short', 'long']);
  assert.ok(!JSON.stringify(value).includes('inaccessible'));
  await assert.rejects(api.save(id, 'community', 'foreign', 1, [{ key: 'enabled' }], validate), /不可编辑/);
  await assert.rejects(api.save(id, 'community', 'fixture', 0, [{ key: 'enabled' }], validate), /已更新/);
  await assert.rejects(api.save(id, 'community', 'fixture', 1, [{ key: 'apiKey' }], validate), /不可编辑/);
  await assert.rejects(api.save(id, 'community', 'fixture', 1, [{ key: 'choices', value: [{ secret: 'secret' }] }], validate), /值无效/);
  const saved = await api.save(id, 'community', 'fixture', 1, [{ key: 'style', value: 'long' },
    { key: 'choices', value: [{ label: 'Updated', enabled: false }] }], validate);
  assert.equal(saved.sections[0].revision, 2);
  assert.equal(saved.sections[0].fields[1].value, 'long');
});
