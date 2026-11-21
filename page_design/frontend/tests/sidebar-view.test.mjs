import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/app/sidebarView.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(value) {
  const storage = new Map(value ? [['somnus.sidebar-view.v1', value]] : []), events = [], exports = {};
  const context = { exports, require: () => ({}), localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } }, window: { dispatchEvent: event => events.push(event) } };
  vm.runInNewContext(source, context);
  return { exports, storage, events };
}
test('sidebar view choices persist independent grouping, sort and archive settings and notify mounted surfaces', () => {
  const first = fixture();
  first.exports.saveSidebarView({ group: 'flat', order: 'manual', archived: 'only', manual: ['b', 'a'] });
  const next = fixture(first.storage.get('somnus.sidebar-view.v1'));
  assert.equal(next.exports.readSidebarView().group, 'flat');
  assert.equal(next.exports.readSidebarView().archived, 'only');
  assert.equal(next.exports.readSidebarView().order, 'manual');
  assert.equal(first.events[0].detail.group, 'flat');
  assert.deepEqual(Array.from(next.exports.orderSidebarItems([{ id: 'a' }, { id: 'b' }], next.exports.readSidebarView()), item => item.id), ['b', 'a']);
});
test('invalid stored view settings reset safely and recent order retains pins', () => {
  const f = fixture('{"group":"other","order":"other","archived":"other","manual":[null,3,"a"]}');
  const view = f.exports.readSidebarView();
  assert.equal(view.group, 'workspace'); assert.equal(view.archived, 'hide'); assert.equal(view.order, 'updated');
  assert.deepEqual(Array.from(f.exports.orderSidebarItems([{ id: 'new', updated_at: 5 }, { id: 'pin', pinned: true, updated_at: 1 }, { id: 'old', updated_at: 2 }], view), item => item.id), ['pin', 'new', 'old']);
});
