const assert = require('node:assert/strict');
const { mkdtemp, mkdir, readFile, realpath, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const { createOarIntegration, prepareOarModules, trustedSources } = require('./acp-dsh-oar.cjs');

const vendor = path.resolve(__dirname, '../desktop/dsh_next/oar');
const runtime = process.env.SOMNUS_TEST_OAR_RUNTIME;

test('the exact OAR provider and tool delegate through a native-process protocol with scoped settings',
  { skip: process.platform !== 'win32' || !runtime, timeout: 25_000 }, async t => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'somnus-oar-test-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const workspace = path.join(root, 'workspace');
    const modulesDir = path.join(root, 'modules');
    await Promise.all([workspace, modulesDir].map(dir => mkdir(dir)));
    const expectedCodexHome = path.join(root, 'codex-home');
    const seen = path.join(root, 'seen.json');
    const fixture = path.join(root, 'codex-fixture.cjs');
    const command = path.join(root, 'codex.cmd');
    await writeFile(command, `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`);
    await writeFile(fixture, `
const fs = require('node:fs');
if (process.argv.includes('--help')) { console.log('app-server'); process.exit(0); }
if (process.argv.includes('--version')) { console.log('codex-cli 0.166.0'); process.exit(0); }
const args = process.argv.slice(2);
const print = obj => process.stdout.write(JSON.stringify(obj) + '\n');
const notice = (method, params) => print({method, params});
const reply = (id, result) => print({id, result});
const threadId = 'fixture-thread';
const turnId = 'fixture-turn';
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
  const {id,method,params} = JSON.parse(line);
  if (id === undefined) return;
  if (method === 'thread/start') {
    fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({cwd:params.cwd, args,
      home:process.env.CODEX_HOME, parentCredential:Boolean(process.env.SOMNUS_OAR_SAMPLE_TOKEN)}));
    return reply(id, {thread:{id:threadId}});
  }
  if (method === 'turn/start') {
    reply(id, {turn:{id:turnId,status:'inProgress'}});
    notice('turn/started',{threadId,turn:{id:turnId,status:'inProgress'}});
    notice('item/agentMessage/delta',{threadId,turnId,itemId:'msg',delta:'OAR fixture answer'});
    notice('item/completed',{threadId,turnId,item:{id:'msg',type:'agentMessage',text:'OAR fixture answer'}});
    return notice('turn/completed',{threadId,turn:{id:turnId,status:'completed'}});
  }
  reply(id, {});
});
`.replace("+ '\n'", "+ '\\n'"));

    const transformed = await trustedSources(vendor, runtime);
    const prepared = await prepareOarModules(modulesDir, root, transformed, { codex: command });
    const [providerModule, toolModule] = await Promise.all(prepared.files.map(file => import(pathToFileURL(file).href)));
    const tools = [];
    const runtimeProviders = new Map();
    let spec;
    const ctx = { logger: { warn() {} }, tools: { register: tool => tools.push(tool) }, subagents: {
      getProvider: name => runtimeProviders.get(name), registerProvider: value => runtimeProviders.set(value.name, value),
      startActivation: async value => { spec = value; return { name: 'fixture-1' }; },
    } };
    const [provider, tool] = prepared.rows;
    providerModule.apply(ctx, provider.config);
    toolModule.apply(ctx, tool.config);
    assert.equal(tools[0].name, 'subagent_oar');
    assert.ok(!Object.hasOwn(tools[0].parameters ?? {}, 'cwd'));
    const signal = AbortSignal.timeout(13_000);
    await tools[0].execute({ runtime: 'codex', description: 'fixture', prompt: 'Answer the fixture', cwd: 'C:/untrusted' },
      { agent: {}, signal });
    assert.equal(spec.provider, 'oar-codex');
    assert.ok(!Object.hasOwn(spec, 'cwd'));

    t.mock.method(process, 'emitWarning', () => {});
    const original = process.env.SOMNUS_OAR_SAMPLE_TOKEN;
    process.env.SOMNUS_OAR_SAMPLE_TOKEN = 'fixture-secret';
    process.env.OAR_CODEX_SANDBOX = 'read-only';
    try {
      const child = await runtimeProviders.get('oar-codex').start({ cwd: workspace, prompt: spec.prompt, signal });
      try {
        const result = await child.result;
        assert.match(JSON.stringify(result), /OAR fixture answer/);
        const info = JSON.parse(await readFile(seen, 'utf8'));
        assert.equal(info.cwd, workspace);
        assert.equal(info.home, expectedCodexHome);
        assert.equal(info.parentCredential, false);
        assert.ok(info.args.includes('sandbox_mode="read-only"'));
      } finally { await child.dispose(); }
    } finally {
      delete process.env.OAR_CODEX_SANDBOX;
      if (original === undefined) delete process.env.SOMNUS_OAR_SAMPLE_TOKEN;
      else process.env.SOMNUS_OAR_SAMPLE_TOKEN = original;
    }
  });

test('an unreachable OAR runtime cannot be enabled and an existing preference can be disabled', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'somnus-oar-settings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'agent-oar.json');
  const market = { profileDir: root, resourcesPath: root, runtimeDir: root, launch: async () => null,
    community: { withWebMutation: (_active, update) => update() } };
  const settings = createOarIntegration(market, vendor);
  assert.equal((await settings.status()).enabled, false);
  await assert.rejects(settings.setEnabled(true, () => {}));
  await writeFile(file, JSON.stringify({ enabled: true }));
  assert.equal((await settings.status()).enabled, true);
  assert.equal((await settings.setEnabled(false, () => {})).enabled, false);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { enabled: false });
});
