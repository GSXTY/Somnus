const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.SOMNUS_NODE_DEPENDENCIES||path.join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),'playwright'));
let cleanupBrowser; (async()=>{
 const [origin,cid,otherCid,workspace,shots]=process.argv.slice(2);fs.mkdirSync(shots,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.SOMNUS_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"});cleanupBrowser=browser;const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({workspace,cid})=>{localStorage.setItem('ya70.workspace',workspace);localStorage.setItem('ya70-assistant-last-conversation:'+workspace,cid);window.somnusRuntime={capabilities:async()=>({runtime:'dsh-native',identity:'Somnus',capabilities:{sameSessionEdit:'unsupported'}})};},{workspace,cid});
 const web=process.env.SOMNUS_TEST_WEB; await page.route(origin+'/',route=>route.fulfill({path:path.join(web,'index.html')}));
 await page.route('**/workbench-assets/**',async route=>{const file=path.join(web,new URL(route.request().url()).pathname.replace('/workbench-assets/',''));if(fs.existsSync(file))await route.fulfill({path:file});else await route.continue();});
 await page.goto(origin+'/#assistant?conversation='+cid);await page.getByLabel('工作区视图选项',{exact:true}).waitFor();
 async function option(label){await page.getByLabel('工作区视图选项',{exact:true}).click();await page.getByRole('menuitem',{name:label,exact:true}).click();}
 await page.getByText('Synthetic original input',{exact:true}).waitFor();await page.locator('.assistant-message.user').hover();
 assert.equal(await page.getByLabel('原位编辑并重新发送暂不可用').isDisabled(),true);
 await page.screenshot({path:path.join(shots,'message-hover-actions.png')});
 await page.getByLabel('编辑输入并分支',{exact:true}).click();await page.getByRole('dialog',{name:'创建分支草稿',exact:true}).waitFor();
 await page.getByLabel('编辑分支输入').fill('Synthetic edited draft');await page.screenshot({path:path.join(shots,'branch-draft-honest-boundary.png')});
 await page.getByRole('button',{name:/取\s*消/}).click();
 await page.getByLabel('工作区视图选项',{exact:true}).click();await page.getByRole('menuitem',{name:'按工作区',exact:true}).waitFor();await page.getByRole('menu').evaluate(el=>Promise.all((el.closest('.ant-dropdown')||el).getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:path.join(shots,'workspace-view-options.png')});await page.keyboard.press('Escape');
 await option('平铺全部会话');await page.getByRole('button',{name:'Other project conversation',exact:true}).waitFor();
 await option('仅已归档');await page.locator('.nav-recent-item[title="Archived fixture"]').waitFor();assert.equal(await page.getByRole('button',{name:'Other project conversation',exact:true}).count(),0);
 await page.reload();await page.locator('.nav-recent-item[title="Archived fixture"]').waitFor();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('somnus.sidebar-view.v1')).archived),'only');
 await option('隐藏已归档');await option('手动排序');await page.getByLabel('更多会话操作：Other project conversation',{exact:true}).click();await page.getByRole('menuitem',{name:'上移',exact:true}).click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('somnus.sidebar-view.v1')).manual[0]),otherCid);
 await page.getByRole('button',{name:'Other project conversation',exact:true}).click();await page.getByLabel('会话菜单 · Other project conversation',{exact:true}).waitFor();
 await page.screenshot({path:path.join(shots,'flat-cross-project.png')});
 await option('按文件夹目录树');await page.locator('.nav-source-tree summary').first().waitFor();const tree=page.locator('.nav-source-tree').first();await tree.locator('summary').click();assert.equal(await tree.getAttribute('open'),null);await page.getByLabel('工作区视图选项',{exact:true}).click();await page.getByRole('menuitem',{name:'最近更新',exact:true}).click();assert.equal(await tree.getAttribute('open'),null);await tree.locator('summary').click();await page.screenshot({path:path.join(shots,'folder-grouped-view.png')});
 await page.setViewportSize({width:1040,height:820});await page.screenshot({path:path.join(shots,'compact-sidebar-view.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(shots,'report.json'),JSON.stringify({passed:true,persisted:true,crossProjectNavigation:true,manualOrder:true,folderCollapseSurvivesRender:true,archivedFilter:true,branchDraftOnly:true,sameSessionEditUnsupported:true,pageErrors:errors},null,2));
 console.log('PASS: real UI sidebar grouping, sorting, archive filters, persistence, cross-project navigation and truthful edit controls');await browser.close();
})().catch(async e=>{console.error(e);await cleanupBrowser?.close();process.exitCode=1;});





