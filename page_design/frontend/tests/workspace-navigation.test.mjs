import test from 'node:test';
import assert from 'node:assert/strict';
import { readProjectLaunch, readWorkspaceView, isStandardView, workspacePath, recordWorkspaceVisit } from '../src/workspaceNavigation.mjs';
import { activeRailView, builtInTools, workspaceRail } from '../src/navigation.mjs';

test('assistant and analysis deep links survive reload without promoting arbitrary input to a view', () => {
  for (const view of ['assistant', 'documents', 'analysis']) {
    assert.equal(readWorkspaceView(new URL(`http://127.0.0.1:8765/#${view}`)), view);
    assert.equal(readWorkspaceView(new URL(`http://127.0.0.1:8765/?view=${view}`)), view);
  }
  assert.equal(readWorkspaceView(new URL('http://127.0.0.1:8765/#assistant?conversation=' + 'a'.repeat(32))), 'assistant');
  assert.equal(readWorkspaceView(new URL('http://127.0.0.1:8765/#assistant?conversation=wrong')), 'dashboard');
  const project = new URL('http://127.0.0.1:8765/#assistant?project=ws_0123456789ab');
  assert.equal(readWorkspaceView(project), 'assistant');
  assert.equal(readProjectLaunch(project), 'ws_0123456789ab');
  assert.equal(readProjectLaunch(new URL('http://127.0.0.1:8765/#assistant?project=..%2Fevents')), undefined);
  assert.equal(readWorkspaceView(new URL('http://127.0.0.1:8765/#deep-analysis?task=' + 'b'.repeat(32))), 'deep-analysis');
  assert.equal(readWorkspaceView(new URL('http://127.0.0.1:8765/#unknown')), 'dashboard');
  assert.equal(readWorkspaceView(new URL('http://127.0.0.1:8765/?view=../events')), 'dashboard');
});

test('view navigation remains in the same shell and preserves unrelated URL state', () => {
  assert.equal(workspacePath('analysis', 'http://127.0.0.1:44507/?view=assistant&filter=x#assistant'), '/?filter=x#analysis');
  assert.equal(workspacePath('assistant', 'http://127.0.0.1:44507/#analysis'), '/#assistant');
  assert.equal(workspacePath('dashboard', 'http://127.0.0.1:44507/#analysis'), '/');
  assert.equal(isStandardView('analysis'), false);
  assert.equal(isStandardView('assistant'), false);
  assert.equal(isStandardView('documents'), false);
  for (const view of ['dashboard', 'users', 'devices', 'alerts']) assert.equal(isStandardView(view), true);
  assert.equal(isStandardView('settings'), false);
});

test('workbench history skips duplicate routes and truncates forward history after a new visit', () => {
  const initial = { entries: ['dashboard'], index: 0 };
  const analysis = recordWorkspaceVisit(initial, 'analysis');
  assert.deepEqual(analysis, { entries: ['dashboard', 'analysis'], index: 1 });
  assert.equal(recordWorkspaceVisit(analysis, 'analysis'), analysis);
  assert.deepEqual(recordWorkspaceVisit({ ...analysis, index: 0 }, 'settings'),
    { entries: ['dashboard', 'settings'], index: 1 });
  assert.equal(workspacePath('settings', 'http://127.0.0.1:8765/#analysis'), '/#settings');
  assert.equal(readWorkspaceView(new URL('http://127.0.0.1:8765/#settings')), 'settings');
});

test('tools only lists analysis routes and the data and settings sections retain own rail entries', () => {
  assert.deepEqual(builtInTools.map(item => item.key), ['analysis', 'deep-analysis', 'sql']);
  for (const view of ['users', 'devices', 'alerts']) assert.equal(activeRailView(view), 'dashboard');
  assert.equal(activeRailView('settings'), 'settings');
  assert.equal(activeRailView('documents'), 'documents');
  assert.deepEqual(workspaceRail.slice(0, 3).map(entry => entry.key), ['assistant', 'dashboard', 'documents']);
});
