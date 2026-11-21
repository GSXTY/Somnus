import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/chat/RecentSessions.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
test('running sidebar title remains enabled while destructive menus stay locked', () => {
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const Dropdown = 'Dropdown';
  vm.runInNewContext(source, { exports, require: id => id === 'antd' ? { Dropdown } : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : {} });
  let opened = 0, renamed = 0;
  const render = locked => exports.RecentSessions({ items: [{ id: 'running', title: 'Running', message_count: 1 }], locked,
    runningIds: new Map([['running', true]]), onOpen: () => opened++, onRename: () => renamed++, onDelete() {} });
  const row = render(false).props.children[2][0];
  const context = row.props.children[0];
  assert.equal(context.props.disabled, false, 'Antd clones its child disabled prop: do not pass running here');
  const title = context.props.children;
  assert.equal(title.props.disabled, false);
  title.props.onClick();
  assert.equal(opened, 1);
  assert.equal(context.props.menu.items.every(item => item.disabled), true);
  context.props.menu.onClick({ key: 'rename' });
  assert.equal(renamed, 0);
  assert.equal(row.props.children[1].props.children.props.disabled, true);
  const lockedTitle = render(true).props.children[2][0].props.children[0].props.children;
  assert.equal(lockedTitle.props.disabled, true);
  lockedTitle.props.onClick();
  assert.equal(opened, 1);
});
