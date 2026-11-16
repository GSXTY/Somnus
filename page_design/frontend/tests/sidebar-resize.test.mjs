
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(new URL('../src/SidebarResize.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(initialWidth) {
  let index = 0, onResize;
  const values = [], effects = [], storage = new Map(initialWidth ? [['vvman.sidebar-width', initialWidth]] : []);
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial;
      return [values[i], value => { values[i] = value; }];
    },
    useRef(current) { return values[index++] ||= { current }; },
    useEffect(effect) { const i = index++; if (!effects[i]) effects[i] = { cleanup: effect() }; },
  };
  const exports = {}, window = {
    innerWidth: 1440,
    addEventListener(type, callback) { if (type === 'resize') onResize = callback; },
    removeEventListener() {},
  };
  vm.runInNewContext(source, { exports, window, require: name => name === 'react' ? react : { jsx: (type, props) => ({ type, props }) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
  });
  function render() {
    index = 0;
    const layout = exports.useSidebarLayout();
    const handle = exports.SidebarResizeHandle({ width: layout.width, max: layout.max,
      onCommit: layout.commit, onPreview: layout.preview, onCancel: layout.cancel });
    return { layout, handle: handle.props };
  }
  return { render, storage, viewport(width) { window.innerWidth = width; onResize(); } };
}
const pointer = (x, id = 1) => ({ pointerId: id, clientX: x, button: 0, currentTarget: { setPointerCapture() {} } });
const storageKey = 'vvman.sidebar-width';

test('desktop sidebar width previews drag, persists the commit and restores preference across responsive layouts', () => {
  const sidebar = setup();
  const initial = sidebar.render();
  assert.equal(initial.handle['aria-valuenow'], 268);
  initial.handle.onPointerDown(pointer(268));
  sidebar.render().handle.onPointerMove(pointer(360));
  assert.equal(sidebar.render().layout.width, 360);
  assert(!sidebar.storage.has(storageKey));
  sidebar.render().handle.onPointerUp(pointer(360));
  assert.equal(sidebar.storage.get(storageKey), '360');

  const restarted = setup(sidebar.storage.get(storageKey));
  assert.equal(restarted.render().layout.width, 360);
  restarted.viewport(880);
  assert.equal(restarted.render().layout.compact, true);
  restarted.viewport(1100);
  assert.equal(restarted.render().layout.width, 360);
});

test('width handle supports keyboard, reset and cancelled drag without replacing the saved preference', () => {
  const sidebar = setup('400');
  sidebar.render();
  sidebar.viewport(992);
  assert.equal(sidebar.render().layout.width, 376);
  sidebar.render().handle.onKeyDown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal(sidebar.storage.get(storageKey), '360');
  sidebar.render().handle.onPointerDown(pointer(360));
  sidebar.render().handle.onPointerMove(pointer(512));
  assert.equal(sidebar.render().layout.width, 376);
  sidebar.render().handle.onLostPointerCapture({ pointerId: 1 });
  assert.equal(sidebar.render().layout.width, 360);
  sidebar.render().handle.onKeyDown({ key: 'Home', preventDefault() {} });
  assert.equal(sidebar.render().layout.width, 216);
  sidebar.render().handle.onDoubleClick();
  assert.equal(sidebar.render().layout.width, 268);
});
