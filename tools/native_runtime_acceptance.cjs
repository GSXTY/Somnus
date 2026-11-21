// Synthetic-only live runtime acceptance. Uses only a loopback fake model; no paid model, company data or user profile.
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const childProcess = require('node:child_process'), { createInterface } = require('node:readline');
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (exe, args, options) {
    if (args.includes('--no-open')) {
        const home = options.env.DSH_HOME;
        const env = {
            PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, COMSPEC: process.env.COMSPEC, TEMP: home, TMP: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', SOMNUS_SYNTHETIC_KEY: 'synthetic-only', DSH_SOMNUS_PROJECT_TOKEN: options.env.DSH_SOMNUS_PROJECT_TOKEN, DSH_SOMNUS_PROJECT_ENDPOINT: options.env.DSH_SOMNUS_PROJECT_ENDPOINT
        };
        const child = originalSpawn(exe, args, {
            ...options, env, stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stdout.on('data',bytes=>{const value=bytes.toString();if(!value.includes('dsh web:'))console.error(value.replace(/https?:\/\/\S+/g,'[URL]').replace(/token=[^\s]+/g,'token=[REDACTED]'));});
        child.stderr.on('data', bytes => console.error(bytes.toString().replace(/https?:\/\/\S+/g, '[URL]').replace(/token=[^\s]+/g, 'token=[REDACTED]')));
        return child;
    }
    return originalSpawn(exe, args, options);
};
const { DshPluginMarket } = require('../electron/acp-dsh-market.cjs');
const { NativeHistory } = require('../electron/acp-native-history.cjs');
const { createProjectClient } = require('../electron/acp-project.cjs');
let phase = 'startup';
(async () => {
    const root = path.resolve(__dirname, '..'), temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'somnus-native-acceptance-'));
    let backend, market, modelProcess, toolHost, registry;
    try {
        const repository=path.join(temporary,'git-repo'),worktree=path.join(temporary,'git-worktree');
        await fs.mkdir(repository);const git=(cwd,...args)=>childProcess.execFileSync('git',['-C',cwd,...args],{windowsHide:true,encoding:'utf8'});
        git(repository,'init');git(repository,'config','user.email','synthetic@example.invalid');git(repository,'config','user.name','Synthetic');
        await fs.writeFile(path.join(repository,'tracked.txt'),'ORIGINAL');git(repository,'add','tracked.txt');git(repository,'commit','-m','Synthetic');
        git(repository,'worktree','add','-b','vvman/synthetic-native',worktree);
        await fs.writeFile(path.join(worktree,'tracked.txt'),'MODIFIED-KEEP');await fs.writeFile(path.join(worktree,'untracked.txt'),'UNTRACKED-KEEP');
        const hash=bytes=>require('node:crypto').createHash('sha256').update(bytes).digest('hex');
        const beforeHashes=await Promise.all(['tracked.txt','untracked.txt'].map(async file=>hash(await fs.readFile(path.join(worktree,file)))));
        const pythonEnv = {
            PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: temporary, TMP: temporary, PYTHONPATH: root
        };
        modelProcess = originalSpawn('python', ['-u', 'tests/native_fake_model_fixture.py'], {
            cwd: root, windowsHide: true, env: pythonEnv
        });
        const modelLines = createInterface({
            input: modelProcess.stdout
        });
        const model = await new Promise((resolve, reject) => {
            modelLines.once('line', line => resolve(JSON.parse(line)));
            modelProcess.once('exit', () => reject(Error('Synthetic model fixture failed')));
        });
        backend = originalSpawn('python', ['-u', 'tests/native_session_http_fixture.py'], {
            cwd: root, windowsHide: true, env: {
                PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: temporary, TMP: temporary, PYTHONPATH: root, SOMNUS_TEST_AGENT_ID: 'fbbce833-544a-42a1-8579-cba2a817383e', SOMNUS_TEST_MODEL_ORIGIN: model.origin, ...(process.env.SOMNUS_TEST_PLAIN==='1'?{}:{SOMNUS_TEST_WORKTREE_ROOT:worktree})
            }
        });
        let error = '';
        backend.stderr.on('data', chunk => error += chunk);
        const lines = createInterface({
            input: backend.stdout
        });
        const ready = await new Promise((resolve, reject) => {
            lines.once('line', line => resolve(JSON.parse(line)));
            backend.once('exit', () => reject(Error('Isolated backend failed')));
            setTimeout(() => reject(Error('Backend readiness timeout')), 15000).unref();
        });
        const client = createProjectClient(ready.origin, ready.token), owner = 'synthetic-native-acceptance-owner', runtimeRoot = process.env.SOMNUS_TEST_RUNTIME_ROOT || 'C:/Users/Administrator/AppData/Roaming/RespiratoryViewer', home = path.join(temporary, 'dsh-home'), profile = path.join(home, 'profiles', 'web');
        await fs.mkdir(profile, {
            recursive: true
        });
        await fs.writeFile(path.join(profile, 'package.json'), JSON.stringify({
            name: 'dsh-profile-web', private: true, dsh: {
                profile: {
                    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
                }
            }
        }));
        await fs.symlink(path.join(runtimeRoot, 'dsh-runtime', '0.2.2-rc.1', 'node_modules'), path.join(profile, 'node_modules'), 'junction');
        market = new DshPluginMarket(temporary, path.join(root, 'dist/electron/win-unpacked/resources'), runtimeRoot);
        const { NativeDshChat } = require('../electron/acp-native-dsh-chat.cjs');
        const { RuntimeRegistry } = require('../electron/runtime/registry.cjs');
        market.executionSettings = require('../electron/acp-execution-settings.cjs').createExecutionSettings(temporary);
        const native = new NativeDshChat(market, client, {
            target: async () => ({
                root: ready.root, rootKey: 'source_1'
            })
        });
        const identityChecks = [];
        const originalProjectTool = native.projectTool.bind(native);
        native.projectTool = async (input, signal) => {
            const answer = await originalProjectTool(input, signal);
            if (input.name === 'native_session_identity')
                identityChecks.push({
                    allowed: answer.allowed, matchedTurn: [...native.running.values()].some(turn => turn.turnId === input.requestId), mapped: native.sessions.has(input.sessionId)
                });
            return answer;
        };
        toolHost = await market.openNativeProjectTools();
        const nativePlugin = path.join(temporary, 'project-tools.mjs');
        await fs.writeFile(nativePlugin, toolHost.plugin);
        const {teamworkPlugin,TEAM_COMMAND}=require('../electron/acp-dsh-teamwork.cjs'),{TEAM_PLUGINS}=require('../electron/acp-dsh-web-model.cjs');
        const teamModule=await market.teamToolModule();assert(teamModule,'Real Teamwork module unavailable');const teamPlugin=path.join(temporary,'teamwork.mjs');await fs.writeFile(teamPlugin,teamworkPlugin(require('node:url').pathToFileURL(teamModule).href,'DSH_SOMNUS_PROJECT_ENDPOINT','DSH_SOMNUS_PROJECT_TOKEN'));
        const plugin = path.join(temporary, 'seed.mjs'), patch = path.join(temporary, 'seed.json');
        await fs.writeFile(plugin, `import {randomUUID} from 'node:crypto';import {createUserMessage,createMessage,createToolResultMessage} from '${require('node:url').pathToFileURL(path.join(runtimeRoot, 'dsh-runtime', '0.2.2-rc.1', 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')).href}';export const inject=['commands','sessions'];export function apply(ctx){ctx.commands.register({definitionId:'somnus:synthetic-seed',name:'synthetic-seed',description:'Synthetic-only acceptance fixture',recordInput:false,handler({agent}){const s=agent.session;s.append('turn/start',{turn:1});s.append('user/message',createUserMessage({content:[{type:'text',text:'Synthetic fixture SOMNUS_MEMORY_FORK_PARENT'}],source:{kind:'user',rpcId:'synthetic'}}),{surfaceOp:'append'});s.append('tool/call',{turn:1,step:1,callId:'synthetic-call',name:'synthetic_read',arguments:'{"path":"synthetic.txt"}'});s.append('tool/result',{turn:1,step:1,message:createToolResultMessage({callId:'synthetic-call',content:[{type:'text',text:'SYNTHETIC TOOL RESULT'}],isError:false})},{surfaceOp:'append'});s.append('assistant/message',{turn:1,step:1,stream:[],message:createMessage({role:'assistant',content:[{type:'text',text:'SYNTHETIC NATIVE ANSWER'}],source:{kind:'model',provider:'synthetic',model:'synthetic'}})},{surfaceOp:'append'});s.append('turn/end',{turn:1,reason:{kind:'completed'}});const child=ctx.sessions.create('synthetic-child-${ready.cid}',{meta:{cwd:${JSON.stringify(ready.root)},parentSession:s.id,origin:'subagent'}});child.append('subagent/descriptor',{version:3,mode:'one-shot',provider:'synthetic',label:'Synthetic child'});child.append('turn/start',{turn:1});child.append('user/message',createUserMessage({content:[{type:'text',text:'SOMNUS_MEMORY_CHILD_ONLY'}],source:{kind:'user'}}),{surfaceOp:'append'});for(let index=0;index<125;index++)child.append('user/message',createUserMessage({content:[{type:'text',text:index===124?'中文🙂'.repeat(85000):'SYNTHETIC-HISTORY-'+index}],source:{kind:'user'}}),{surfaceOp:'append'});child.append('assistant/message',{turn:1,step:1,stream:[],message:createMessage({role:'assistant',content:[{type:'text',text:'CHILD SYNTHETIC ANSWER'}],source:{kind:'model',provider:'synthetic',model:'synthetic'}})},{surfaceOp:'append'});child.append('turn/end',{turn:1,reason:{kind:'completed'}});return {kind:'success',text:'seeded'};}});}`);
        childProcess.execFileSync(process.execPath,['--check',plugin],{windowsHide:true});
        await fs.writeFile(patch, JSON.stringify([{
                id: 'llm-pi-ai', config: {
                    providers: {
                        'synthetic-local': {
                            api: 'openai-completions', baseURL: model.origin + '/v1', apiKeyEnv: 'SOMNUS_SYNTHETIC_KEY', models: [{
                                    id: 'synthetic', name: 'Synthetic', reasoning: false, input: ['text'], contextWindow: 64000, maxTokens: 1024, cost: {
                                        input: 0, output: 0, cacheRead: 0, cacheWrite: 0
                                    }
                                }]
                        }
                    }
                }
            }, {
                insert: [{
                        id: 'synthetic-seed', name: require('node:url').pathToFileURL(plugin).href
                    }, {
                        id: 'somnus-project-tools', name: require('node:url').pathToFileURL(nativePlugin).href
                    },TEAM_PLUGINS[0],{id:'somnus-team-tools',name:require('node:url').pathToFileURL(teamPlugin).href},TEAM_PLUGINS[2]]
            }]));
        const launch = await market.launch();
        assert(launch, 'Runtime is unavailable');
        const server = {
            chatUsers: 0
        };
        market.settingsServer = server;
        server.ready = market.spawnSettings(server, launch, null, {
            file: patch, env: toolHost.env
        });
        await server.ready;
        let nativePromptSubmissions=0;
        market.account.request = async (server, method, args) => {
            if(method==='session/prompt')nativePromptSubmissions++;
            const credentials = await market.account.credentials(server), rpcId = require('node:crypto').randomUUID();
            const reply = await (await fetch(credentials.origin + '/api/' + method, {
                method: 'POST', headers: {
                    'Content-Type': 'application/json', origin: credentials.origin, cookie: credentials.cookie
                }, body: JSON.stringify({
                    type: 'client-request', rpcId, method, payload: {
                        args
                    }
                })
            })).json();
            if (reply.result?.ok !== true)
                throw Object.assign(Error(reply.result?.error?.message || 'Synthetic RPC failed'), {
                    code: reply.result?.error?.code
                });
            return reply.result.value;
        };
        const rpc = (method, request) => market.account.request(server, 'session/' + method, {
            request
        });
        const parent = 'somnus-' + ready.cid + '-123456789abc';
        phase = 'session-create';
        await rpc('create', {
            sessionId: parent, cwd: ready.root
        });
        phase = 'synthetic-seed';
        const credentials = await market.account.credentials(server);
        const seedRpc = require('node:crypto').randomUUID();
        const seedRaw = await (await fetch(credentials.origin + '/api/commands/execute', {
            method: 'POST', headers: {
                'Content-Type': 'application/json', origin: credentials.origin, cookie: credentials.cookie
            }, body: JSON.stringify({
                type: 'client-request', rpcId: seedRpc, method: 'commands/execute', payload: {
                    args: {
                        agentId: parent, line: '/synthetic-seed', submittedAttachments: []
                    }
                }
            })
        })).json();
        if (!seedRaw.result?.ok)
            throw Error('Synthetic seed failure: ' + JSON.stringify(seedRaw.result?.error));
        const seeded = seedRaw.result.value;
        assert.equal(seeded?.result?.kind, 'success', 'Synthetic command unavailable: ' + JSON.stringify(seeded));
        phase = 'native-events';
        const events = await rpc('events', {
            address: {
                kind: 'session', sessionId: parent
            }, maxMessages: 100
        });
        const assistant = events.records.findLast(row => row.event.type === 'assistant/message');
        assert(assistant, 'Synthetic assistant event was not created');
        const childName = 'synthetic-child-' + ready.cid, childAddress = {
            kind: 'subagent', parentSessionId: parent, childSessionId: childName, mode: 'one-shot'
        }, childEvents = await rpc('events', {
            address: childAddress, maxMessages: 100
        }), childAnswer = childEvents.records.findLast(row => row.event.type === 'assistant/message'), childStep = 'dsh-child-' + require('node:crypto').createHash('sha256').update(childName).digest('hex').slice(0, 24);
        const route = {
            conversationId: ready.cid, taskId: ready.turn_id
        };
        phase = 'backend-claim';
        const claim = await client.runtimeTaskState(route, {
            agent_id: ready.agent, owner_id: owner, sequence: 1, status: 'running'
        });
        phase = 'backend-bind';
        await client.bindNativeSession(ready.cid, {
            turn_id: ready.turn_id, owner_id: owner, session_id: parent, start_seq: 0, last_seq: events.cursor, assistant_event_seq: assistant.event.seq, children: [{
                    session_id: childName, parent_session_id: parent, source_seq: 0, last_seq: childEvents.cursor
                }]
        });
        phase = 'backend-finish';
        await client.finishRuntimeTask(route, {
            agent_id: ready.agent, owner_id: owner, finish_receipt: claim.finish_receipt, status: 'complete', content: 'SYNTHETIC NATIVE ANSWER', execution: {
                steps: [{
                        id: childStep, title: 'Synthetic child', kind: 'subagent', status: 'completed'
                    }], plan: []
            }
        });
        const chat = {
            projectClient: client, market, running: new Map(), rpc: (_server, method, args) => market.account.request(server, method, args)
        };
        market.settings = async () => server;
        const history = new NativeHistory(chat);
        const input = {
            conversationId: ready.cid, turnId: ready.turn_id, worktreePolicy:'share-current'
        };
        phase = 'history-ledger';
        const ledger = await history.ledger(input, () => {
        });
        assert(ledger.records.some(row => row.type === 'tool/call'));
        await require('../electron/acp-dsh-subagent-detail.cjs').saveRanges(market.home, ready.cid, ready.turn_id, new Map([[childStep, {
                    sessionId: childName, parentId: parent, mode: 'one-shot', after: 0, through: childEvents.cursor
                }]]));
        phase = 'native-child-fork';
        const childFork = await history.fork({
            ...input, subagentId: childStep, atSeq: childAnswer.event.seq
        }, () => {
        });
        assert.notEqual(childFork.conversationId, ready.cid);
        const archiveRows=[];let archiveCursor;
        do { const page=await client.inheritedHistory(childFork.conversationId,archiveCursor,50);archiveRows.push(...(page.records||[]));archiveCursor=page.has_more?page.next_cursor:null; } while(archiveCursor);
        const longContent=archiveRows.filter(row=>row.content?.includes('中文')).sort((a,b)=>a.part-b.part).map(row=>row.content).join('');
        assert.equal(hash(longContent),hash('中文🙂'.repeat(85000)));assert(archiveRows.length>125);
        phase = 'native-fork';
        const fork = await history.fork(input, () => {
        });
        const mapping = await client.nativeSession(fork.conversationId, ready.agent);
        assert.equal(mapping.runtime_session_id, fork.sessionId);
        const child = await rpc('events', {
            address: {
                kind: 'session', sessionId: fork.sessionId
            }, maxMessages: 100
        });
        assert(child.records.some(row => row.event.type === 'tool/result'), 'Fork must inherit real tool evidence');
        const permissions = await market.account.request(server, 'commands/execute', {
            agentId: fork.sessionId, line: '/permission read-only', submittedAttachments: []
        });
        assert.equal(permissions.result.kind, 'success');
        const next = await (await fetch(ready.origin + '/fixture/reserve', {
            method: 'POST', headers: {
                'Content-Type': 'application/json'
            }, body: JSON.stringify({
                conversation_id: fork.conversationId
            })
        })).json();
        assert(next.turn_id);
        assert.notEqual(next.turn_id, ready.turn_id);
        const prepared = await client.prepare({
            conversationId: fork.conversationId, turnId: next.turn_id, agentId: ready.agent
        });
        server.companyModel = prepared.company_model;
        server.companyModels = [{
                id: prepared.company_model, provider: 'synthetic-local', runtimeModel: 'synthetic'
            }];
        server.config = {
            personal: true
        };
        server.modelRevision = prepared.company_revision;
        server.projectTools = true;
        server.teamwork = true;
        registry = new RuntimeRegistry({
            native, projectClient: client
        });
        phase = 'native-continued-prompt';
        const answer = await registry.run('dsh-native', 'prompt', {
            conversationId: fork.conversationId, turnId: next.turn_id, agentId: ready.agent
        }, () => {
        }, () => {
        });
        assert(answer.text.includes('SYNTHETIC-CONTINUE'));
        assert(answer.text.includes('SOMNUS_MEMORY_FORK_PARENT'));
        const requests = await (await fetch(model.origin + '/requests')).json();
        assert.equal(requests.requests.length, 1);
        assert.equal(requests.requests[0].somnus_identity, true, JSON.stringify({
            identityChecks
        }));
        const matrix=[];
        const reserve=async(cid,content)=>{const response=await fetch(ready.origin+'/fixture/reserve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation_id:cid,content,...(content==='SOMNUS_MEMORY_CHILD_false'?{file_ids:[ready.doc_id],skill_ids:[ready.skill_id]}:{})})});const value=await response.json();assert(response.ok,JSON.stringify(value));return value.turn_id;};
        const invoke=async(cid,enabled,marker)=>{
            market.executionSettings.setTeamwork(cid,enabled);
            const turnId=await reserve(cid,marker);
            const answer=await registry.run('dsh-native','prompt',{conversationId:cid,turnId,agentId:ready.agent},()=>{},()=>{});
            assert(answer.text.includes('SYNTHETIC-CONTINUE'));assert(!answer.persistencePending);
            assert.equal(market.executionSettings.teamwork(cid),enabled);
            matrix.push({enabled,nativeConversation:true});
            return turnId;
        };
        for(const sourceEnabled of [false,true]){
            const sourceTurn=await invoke(ready.cid,sourceEnabled,'SOMNUS_MEMORY_SOURCE_'+sourceEnabled);
            const branch=await history.fork({conversationId:ready.cid,turnId:sourceTurn,worktreePolicy:'share-current'},()=>{});
            assert.equal(market.executionSettings.teamwork(branch.conversationId),false,'Independent new branch starts with explicit Teamwork off');
            for(const targetEnabled of [false,true])await invoke(branch.conversationId,targetEnabled,'SOMNUS_MEMORY_FORK_'+sourceEnabled+'_'+targetEnabled);
        }
        for(const enabled of [false,true])await invoke(childFork.conversationId,enabled,'SOMNUS_MEMORY_CHILD_'+enabled);
        const linked=await client.childConversation(ready.cid,ready.turn_id,childStep);assert.equal(linked.status,'linked');assert.equal(linked.conversation_id,childFork.conversationId);
        const existing=await history.fork({...input,subagentId:childStep,atSeq:childAnswer.event.seq},()=>{});assert.equal(existing.existing,true);assert.equal(existing.conversationId,childFork.conversationId);
        const denied=await market.account.request(server,'commands/execute',{agentId:fork.sessionId,line:'/'+TEAM_COMMAND+' '+require('node:crypto').randomUUID(),submittedAttachments:[]});assert.equal(denied.result.kind,'error','Unclaimed command must not change Teamwork');
        await assert.rejects(native.projectTool({sessionId:fork.sessionId,requestId:'old-task',name:'native_teamwork_claim',args:{}},new AbortController().signal),/授权/);
        assert.deepEqual(await Promise.all(['tracked.txt','untracked.txt'].map(async file=>hash(await fs.readFile(path.join(worktree,file))))),beforeHashes);
        const finalRequests=await(await fetch(model.origin+'/requests')).json();assert.equal(nativePromptSubmissions,9,'No replay: exactly one native prompt submission per authorized turn');assert(finalRequests.requests.length>=nativePromptSubmissions);assert(finalRequests.requests.some(row=>row.document_marker&&row.skill_marker),'Child pane document and Skill must reach the actual synthetic model request');
        const described=await market.account.request(server,'settings/describe',{});let nativeSettingVerified=false;
        for(const section of described.namespaces||[]) {
            const rootSchema=section.schema?.refs?.[section.schema?.uid];
            if(!section.autoGenerate||rootSchema?.type!=='object')continue;
            for(const [key,ref] of Object.entries(rootSchema.dict||{})) {
                const node=section.schema.refs[ref];
                if(node?.type!=='boolean'||node.meta?.hidden||node.meta?.role==='secret'||/secret|token|password|auth/i.test(key)||typeof section.value?.[key]!=='boolean')continue;
                try {
                    const original=section.value[key];
                    const updated=await market.account.request(server,'settings/mutate',{ns:section.ns,expectedRevision:section.revision,ops:[{op:'set',path:[key],value:!original}]});
                    const after=await market.account.request(server,'settings/describe',{}),saved=after.namespaces.find(row=>row.ns===section.ns);
                    assert.equal(saved.value[key],!original);assert(saved.revision>section.revision);
                    await market.account.request(server,'settings/mutate',{ns:section.ns,expectedRevision:saved.revision,ops:[{op:'set',path:[key],value:original}]});
                    nativeSettingVerified=true;break;
                }catch(error){if(error.code==='ERR_ASSERTION')throw error;}
            }
            if(nativeSettingVerified)break;
        }
        assert(nativeSettingVerified,'An isolated real DSH namespace must accept a revisioned setting mutation/readback');
        const restarted=await fetch(ready.origin+'/fixture/restart',{method:'POST'});assert(restarted.ok);
        const restoredArchive=[];let restoredCursor;
        do {const page=await client.inheritedHistory(childFork.conversationId,restoredCursor,50);restoredArchive.push(...(page.records||[]));restoredCursor=page.has_more?page.next_cursor:null;}while(restoredCursor);
        assert.deepEqual(restoredArchive,archiveRows);const restoredLink=await client.childConversation(ready.cid,ready.turn_id,childStep);assert.equal(restoredLink.conversation_id,childFork.conversationId);
        const report = {
            passed: true, worktreeShared:ready.worktree===true,realNativeSettingsMutationVerified:true,documentAndSkillPayloadVerified:true, dirtyFilesPreserved:true, longChildHistoryFragments:archiveRows.length,longChildUnicodeHashVerified:true,archiveAndChildAssociationSurviveBackendRestart:true, realNativeFork: true, inheritedToolEvents: true, independentConversation: true, newTurnReserved: true, modelPrompts: 0, syntheticModelRequests: finalRequests.requests.length, nativePromptSubmissions, paidModelRequests:0, teamMatrix:matrix, childLinkRestored:true, duplicateChildForkPrevented:true, oldClaimRejected:true, realTeamOverlay:true, realNativeContinuation: true, realChildFork: true, identityHookVerified: true
        };
        await fs.writeFile((await import(require('node:url').pathToFileURL(path.join(root,'desktop/storage-paths.mjs')).href)).cachePath(root,'tmp',process.env.SOMNUS_TEST_PLAIN==='1'?'native-plain-acceptance-report.json':'native-workspace-acceptance-report.json'),JSON.stringify(report,null,2));
        console.log(JSON.stringify(report));
    }
    finally {
        registry?.close();
        toolHost?.dispose();
        await market?.closeSettings().catch(() => {
        });
        backend?.kill();
        modelProcess?.kill();
        const resolved = await fs.realpath(temporary), tempRoot = await fs.realpath(os.tmpdir());
        if (path.dirname(resolved).toLowerCase() !== tempRoot.toLowerCase() || !path.basename(resolved).startsWith('somnus-native-acceptance-'))
            throw Error('Temporary cleanup path failed verification');
        const junction = path.join(resolved, 'dsh-home', 'profiles', 'web', 'node_modules');
        const link = await fs.lstat(junction).catch(() => null);
        if (link) {
            if (!link.isSymbolicLink())
                throw Error('Runtime reference is not a junction; cleanup refused');
            await fs.rmdir(junction);
        }
        await fs.rm(resolved, {
            recursive: true, force: true, maxRetries: 8, retryDelay: 300
        }).catch(() => console.error('Temporary fixture cleanup will need retry.'));
    }
})().catch(error => {
    console.error(JSON.stringify({
        phase, code: error.code, message: error.message
    }));
    process.exitCode = 1;
});
