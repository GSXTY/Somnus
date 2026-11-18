const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { launchWorkspace } = require('./workspace-launch.cjs');

test('workspace launch passes chosen folder to fixed applications without shell interpolation', async () => {
  const folder = 'D:\\Team & files';
  const calls = [];
  const options = {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\User Data', ProgramFiles: 'C:\\Program Files' },
    inspect: async () => ({ isFile: () => true }),
    launch(executable, args, spawnOptions) {
      const child = new EventEmitter();
      child.unref = () => {};
      calls.push({ executable, args, spawnOptions });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
  };
  const shell = { openPath: async target => { assert.equal(target, folder); return ''; } };
  await launchWorkspace(shell, folder, undefined, options);
  await launchWorkspace(shell, folder, 'vscode', options);
  await launchWorkspace(shell, folder, 'git-bash', options);
  await launchWorkspace(shell, folder, 'terminal', options);
  assert.deepEqual(calls.map(call => call.args), [
    [folder], ['--cd=' + folder],
    ['/d', '/c', 'start', '""', '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"', '-NoLogo'],
  ]);
  assert.equal(calls[2].executable, 'C:\\Windows\\System32\\cmd.exe');
  assert.ok(calls.every(call => call.spawnOptions.cwd === folder && call.spawnOptions.shell === false));
  await assert.rejects(launchWorkspace(shell, folder, 'missing', options), /请选择支持/);
  await assert.rejects(launchWorkspace(shell, folder, 'vscode', {
    ...options, inspect: async () => { throw new Error('missing'); },
  }), /找不到 VS Code/);
});
