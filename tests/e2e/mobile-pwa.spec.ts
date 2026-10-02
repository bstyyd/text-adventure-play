import { test,expect, type Page } from '@playwright/test';
import { temporaryRepo,inputFor,testEngine } from '../helpers';
import { exportSave } from '../../src/storage/transfer';
import { stoppableOrigin } from './network-fixtures';
import { readFile } from 'node:fs/promises';
// Deterministic API fault injection should not race an installing Service Worker.
const networkTest=test.extend({serviceWorkers:'block'});
test.use({timezoneId:'Asia/Shanghai'});
async function game(page:Page,title='移动书库',url='/'){
  await page.goto(url,{waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'存档',exact:true}).click();await page.getByLabel('卷册名').fill(title);await page.getByRole('button',{name:'开始新故事'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.chapter-heading')).toContainText(title);await expect(page.locator('.story-turn')).toHaveCount(1);
}
for(const width of [360,390,430,768,1440])test('single reader and controls fit width '+width,async({page})=>{
  await page.setViewportSize({width,height:850});await game(page,'视口 '+width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.locator('.reading-space').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport();
  await page.getByLabel('自由输入').fill('第一行中文');await page.getByLabel('自由输入').press('Enter');await page.getByLabel('自由输入').pressSequentially('第二行');
  await expect(page.getByLabel('自由输入')).toHaveValue('第一行中文\n第二行');await expect(page.locator('.story-turn')).toHaveCount(1);
  await page.getByLabel('自由输入').dispatchEvent('compositionstart');await page.getByLabel('自由输入').dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});await page.getByLabel('自由输入').dispatchEvent('compositionend');
  await expect(page.locator('.story-turn')).toHaveCount(1);await page.waitForTimeout(250);
  await page.reload();await expect(page.getByLabel('自由输入')).toHaveValue('第一行中文\n第二行');
  await page.getByRole('button',{name:'人物簿',exact:true}).click();await expect(page.getByLabel('搜索人物')).toBeVisible();
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('heading',{name:'主存档数据'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/'+(test.info().project.name||'edge')+'-mobile-'+width+'.png'});
});
test('downloaded story opens offline, restores drafts, exports full copy and never generates offline',async({page,context,browserName,baseURL})=>{
  const origin=browserName==='webkit'?await stoppableOrigin(baseURL!):null;
  try{
  await page.setViewportSize({width:390,height:844});await game(page,'离线阅读验证',origin?.url||'/');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  const copyResponse=page.waitForResponse('**/offline');
  await page.getByRole('button',{name:'下载此存档供离线阅读',exact:true}).click();
  const copy=await(await copyResponse).json();
  const onlineText=await(await page.request.get((origin?.url||baseURL)+'/api/saves/'+copy.saveId+'/export?format=txt&branch='+copy.bootstrap.saves[0].currentBranchId)).text();
  await expect(page.getByLabel('安装与离线阅读')).toContainText('已完整下载：离线阅读验证');
  await expect(page.getByLabel('安装与离线阅读')).toContainText('离线应用资源已就绪');
  await page.getByRole('button',{name:'故事',exact:true}).click();await page.getByLabel('自由输入').fill('离线的未发送草稿');await page.waitForTimeout(250);
  let posts=0;page.on('request',r=>{if(r.url().endsWith('/turns')&&r.method()==='POST')posts++;});
  if(origin)await origin.disconnect();else await context.setOffline(true);
  await page.reload();await expect(page.locator('.story-turn')).toHaveCount(1);
  await expect(page.getByLabel('自由输入')).toHaveValue('离线的未发送草稿');await expect(page.getByRole('button',{name:'发送',exact:true})).toBeDisabled();
  await expect(page.locator('.connection-banner')).toContainText('当前离线');
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByLabel('安装与离线阅读')).toContainText('离线应用资源已就绪');
  await page.getByRole('button',{name:'人物簿',exact:true}).click();await expect(page.getByLabel('搜索人物')).toBeVisible();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'可恢复 JSON',exact:true}).click();expect((await download).suggestedFilename()).toBe('离线阅读验证.json');
  const readingDownload=page.waitForEvent('download');await page.getByRole('button',{name:'阅读版 TXT',exact:true}).click();
  expect(await readFile((await(await readingDownload).path())!,'utf8')).toBe(onlineText);
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
  if(origin){await origin.reconnect();await page.getByRole('button',{name:'检查连接',exact:true}).click();}else await context.setOffline(false);
  await page.waitForTimeout(700);expect(posts).toBe(0);
  const cached=await page.evaluate(async()=>{const names=await caches.keys();return (await Promise.all(names.map(async n=>(await(await caches.open(n)).keys()).map(r=>r.url)))).flat();});expect(cached.some(url=>new URL(url).pathname.startsWith('/api/'))).toBe(false);
  }finally{await origin?.close();}
});
networkTest('accepted request with lost response recovers its ID after reload without a second POST',async({page})=>{
  await game(page,'请求幂等恢复');let sends=0;
  await page.route('**/api/turns',async route=>{sends++;await route.fetch();await route.abort('connectionreset');});
  await page.getByLabel('自由输入').fill('让沈彻进来');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.connection-banner')).toBeVisible();
  await page.unroute('**/api/turns');await page.reload();
  await expect(page.locator('.story-turn')).toHaveCount(2);expect(sends).toBe(1);
  await expect(page.locator('.request-recovery')).toHaveCount(0);
});
test('leaving old prose and returning restores reading position; keyboard viewport keeps composer visible',async({page})=>{
  await page.setViewportSize({width:390,height:844});await game(page,'阅读位置');
  await page.locator('.reader').evaluate(el=>{el.scrollTop=270;el.dispatchEvent(new Event('scroll'));});
  const before=await page.locator('.reader').evaluate(el=>el.scrollTop);
  await page.getByRole('button',{name:'往事',exact:true}).click();await page.getByRole('button',{name:'故事',exact:true}).click();
  await expect.poll(()=>page.locator('.reader').evaluate((el,position)=>Math.abs(el.scrollTop-position),before)).toBeLessThan(4);
  await page.setViewportSize({width:390,height:430});await page.getByLabel('自由输入').focus();await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport();
  const bounds=await page.locator('.reader').boundingBox();expect(bounds!.height).toBeGreaterThan(60);
  expect(await page.getByLabel('自由输入').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
});
networkTest('streaming while reading older paragraphs leaves the reader in place',async({page})=>{
  await page.setViewportSize({width:430,height:900});await game(page,'流式翻阅');let chunks=0;
  await page.route('**/api/drafts/*',async route=>{
    if(route.request().method()!=='GET'){await route.continue();return;}
    const res=await route.fetch(),d=await res.json();chunks++;
    await route.fulfill({json:{...d,status:'generating',body:('窗外静静落雨。\n\n').repeat(80)+'本次片段 '+chunks,bodyComplete:false}});
  });
  await page.getByLabel('自由输入').fill('让沈彻进来');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.draft-card')).toContainText('窗外静静落雨');
  await page.locator('.reader').evaluate(el=>{el.scrollTop=100;el.dispatchEvent(new Event('scroll'));});
  const old=await page.locator('.reader').evaluate(el=>el.scrollTop),count=chunks;
  await expect.poll(()=>chunks).toBeGreaterThan(count);
  expect(await page.locator('.reader').evaluate(el=>el.scrollTop)).toBe(old);
  await expect(page.getByRole('button',{name:'有新内容 · 回到最新'})).toBeVisible();
});
test('waiting PWA update does not refresh or clear an input draft',async({page})=>{
  await game(page,'版本更新保留输入');await page.getByLabel('自由输入').fill('更新前仍在编辑');await page.waitForTimeout(200);
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByLabel('安装与离线阅读')).toContainText('离线应用资源已就绪');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;await navigator.serviceWorker.register('/sw.js?update-fixture=1',{scope:'/',updateViaCache:'none'});});
  await expect(page.getByText('有新版本可用',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'保存就绪后更新应用'})).toBeDisabled();
  await page.getByRole('button',{name:'故事',exact:true}).click();await expect(page.getByLabel('自由输入')).toHaveValue('更新前仍在编辑');
  await page.getByLabel('自由输入').fill('');await page.waitForTimeout(200);await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'保存就绪后更新应用'}).click();
  await expect(page.locator('.story-turn')).toHaveCount(1);await expect(page.locator('.chapter-heading')).toContainText('版本更新保留输入');
});
test('phone file import, chapter pagination, date search and downloadable reading exports',async({page})=>{
  test.setTimeout(90000);
  const repo=temporaryRepo();let archive='';
  try{const save=repo.createSave({title:'分组长篇'}),engine=testEngine(repo);for(let i=0;i<22;i++){const input=inputFor(repo,save.id,'第'+i+'次静候');engine.start(input);await engine.wait(input.clientRequestId);expect(repo.draft(input.clientRequestId).status).toBe('committed');}archive=JSON.stringify(exportSave(repo,save.id));}finally{repo.close();}
  await page.setViewportSize({width:360,height:820});await game(page,'导入前原档');await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'完整长篇.json',mimeType:'application/json',buffer:Buffer.from(archive)});
  await expect(page.locator('.chapter-heading')).toContainText('分组长篇');await expect(page.locator('.story-turn')).toHaveCount(3);
  await page.getByRole('button',{name:'上一组章节'}).click();await expect(page.locator('.story-turn')).toHaveCount(20);
  await page.getByRole('button',{name:'往事',exact:true}).click();await expect(page.locator('.history-card')).toHaveCount(20);
  await page.getByLabel('游戏日期起').fill('1-3-28');await page.getByLabel('游戏日期止').fill('1-3-28');await page.getByLabel('搜索原文').fill('第21次静候');await expect(page.locator('.history-card')).toHaveCount(1);
  await page.getByRole('button',{name:'存档',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'阅读版 TXT',exact:true}).click();expect((await download).suggestedFilename()).toMatch(/\.txt$/);
  await expect(page.locator('.save-list')).toContainText('导入前原档');
});
test('another device committing first reports conflict and retains the local input for review',async({page})=>{
  await game(page,'跨设备冲突');const session=await(await page.request.get('/api/session')).json(),boot=await(await page.request.get('/api/bootstrap')).json();
  const save=boot.saves.find((s:{title:string})=>s.title==='跨设备冲突'),view=await(await page.request.get('/api/saves/'+save.id)).json();
  const id=crypto.randomUUID();await page.request.post('/api/turns',{headers:{'x-dayao-csrf':session.csrf},data:{clientRequestId:id,saveId:save.id,branchId:view.branch.id,expectedHeadTurnId:view.branch.headTurnId,playerText:'让沈彻进来',target:null,mode:'story'}});
  await expect.poll(async()=>(await(await page.request.get('/api/requests/'+id)).json()).draft.status).toBe('committed');
  await page.getByLabel('自由输入').fill('尚未发送的决定');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('button',{name:'刷新当前分支'})).toBeVisible();await expect(page.getByLabel('自由输入')).toHaveValue('尚未发送的决定');
  await page.getByRole('button',{name:'刷新当前分支'}).click();await expect(page.locator('.story-turn')).toHaveCount(2);await expect(page.getByLabel('自由输入')).toHaveValue('尚未发送的决定');
});
test('interrupted IndexedDB copy replacement retains the last complete download',async({page})=>{
  await game(page,'副本原子替换');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'下载此存档供离线阅读',exact:true}).click();await expect(page.getByLabel('安装与离线阅读')).toContainText('已完整下载：副本原子替换');
  const revision=await page.locator('.pwa-tools code').innerText();
  await page.evaluate(()=>{const old=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){const r=old.call(this,value,key);if(String(key).startsWith('copy:'))this.transaction.abort();return r;};});
  await page.getByRole('button',{name:'下载此存档供离线阅读',exact:true}).click();await expect(page.locator('.notice')).toContainText('浏览器无法保存数据');
  await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.locator('.pwa-tools code')).toHaveText(revision);
});
networkTest('real playing date filters use the displayed local day across UTC midnight',async({page})=>{
  await page.route('**/api/saves/*',async route=>{
    if(route.request().method()!=='GET'){await route.continue();return;}
    const res=await route.fetch(),view=await res.json();
    if(view.turns)view.turns=view.turns.map((t:Record<string,unknown>)=>({...t,createdAt:'2026-09-27T16:30:00.000Z'}));
    await route.fulfill({json:view});
  });
  await page.setViewportSize({width:390,height:844});await game(page,'现实跨日');await page.getByRole('button',{name:'往事',exact:true}).click();
  await page.getByText('现实游玩日期与书签筛选',{exact:true}).click();const dates=page.locator('.filter-card input[type=date]');
  await dates.first().fill('2026-09-28');await dates.last().fill('2026-09-28');await expect(page.locator('.history-card')).toHaveCount(1);
  await dates.first().fill('2026-09-27');await dates.last().fill('2026-09-27');await expect(page.locator('.history-card')).toHaveCount(0);
});

test('switching volumes before the debounce flushes Chinese input and restores each route independently',async({page})=>{
  await page.addInitScript(()=>{
    const schedule=window.setTimeout.bind(window);
    Object.defineProperty(window,'setTimeout',{value:(handler:TimerHandler,delay?:number,...args:unknown[])=>schedule(handler,delay===120?10000:delay,...args)});
  });
  await page.setViewportSize({width:360,height:820});await game(page,'草稿卷甲');
  await page.getByLabel('自由输入').fill('刚刚写完的中文\n尚未发送');await page.getByLabel('OOC · 出戏').check();
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.getByLabel('卷册名').fill('草稿卷乙');await page.getByRole('button',{name:'开始新故事'}).click();
  await expect(page.locator('.chapter-heading')).toContainText('草稿卷乙');await expect(page.getByLabel('自由输入')).toHaveValue('');
  await page.getByLabel('自由输入').fill('另一卷的不同草稿');
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.locator('.save-list').getByRole('button',{name:/草稿卷甲/}).click();
  await expect(page.getByLabel('自由输入')).toHaveValue('刚刚写完的中文\n尚未发送');await expect(page.getByLabel('OOC · 出戏')).toBeChecked();
  await page.reload();await expect(page.locator('.chapter-heading')).toContainText('草稿卷甲');await expect(page.getByLabel('自由输入')).toHaveValue('刚刚写完的中文\n尚未发送');
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.locator('.save-list').getByRole('button',{name:/草稿卷乙/}).click();
  await expect(page.getByLabel('自由输入')).toHaveValue('另一卷的不同草稿');await expect(page.getByLabel('OOC · 出戏')).not.toBeChecked();
});

networkTest('a slow earlier volume response does not replace the later selected volume',async({page})=>{
  await game(page,'慢响应卷甲');const boot=await(await page.request.get('/api/bootstrap')).json();
  const id=boot.saves.find((save:{title:string})=>save.title==='慢响应卷甲').id;
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.getByLabel('卷册名').fill('最终选择卷乙');await page.getByRole('button',{name:'开始新故事'}).click();
  await expect(page.locator('.chapter-heading')).toContainText('最终选择卷乙');
  let release:()=>void=()=>{};const delayed=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/saves/'+id,async route=>{await delayed;await route.continue();});
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.locator('.save-list').getByRole('button',{name:/慢响应卷甲/}).click();
  await page.locator('.save-list').getByRole('button',{name:/最终选择卷乙/}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const response=page.waitForResponse('**/api/saves/'+id);release();await response;await page.waitForTimeout(250);
  await expect(page.locator('.chapter-heading')).toContainText('最终选择卷乙');
});

test('install capability captured on the story page survives opening and leaving Settings',async({page})=>{
  await game(page,'安装入口');
  await page.evaluate(()=>{
    const event=new Event('beforeinstallprompt',{cancelable:true});
    Object.defineProperties(event,{prompt:{value:async()=>{document.documentElement.dataset.installCalled='1';}},userChoice:{value:Promise.resolve({outcome:'dismissed'})}});
    window.dispatchEvent(event);
  });
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('button',{name:'添加到主屏幕',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'人物簿',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'添加到主屏幕',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.dataset.installCalled)).toBe('1');
  await expect(page.getByLabel('安装与离线阅读')).toContainText('分享 → 添加到主屏幕');
  await page.evaluate(()=>window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByLabel('安装与离线阅读')).toContainText('已添加到主屏幕');
});

test('VisualViewport keyboard offsets, pinch zoom and landscape keep reading and input available',async({page})=>{
  await page.setViewportSize({width:390,height:844});await game(page,'键盘与横屏');
  for(const name of ['故事','往事','人物簿','设置','发送']){
    const box=await page.getByRole('button',{name,exact:true}).boundingBox();expect(box!.width).toBeGreaterThanOrEqual(44);expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByLabel('自由输入').focus();
  await page.evaluate(()=>{const viewport=window.visualViewport!;Object.defineProperties(viewport,{height:{configurable:true,value:360},offsetTop:{configurable:true,value:56}});viewport.dispatchEvent(new Event('resize'));});
  await expect(page.locator('html')).toHaveAttribute('data-keyboard','true');
  const send=await page.getByRole('button',{name:'发送',exact:true}).boundingBox(),read=await page.locator('.reader').boundingBox();
  expect(send!.y+send!.height).toBeLessThanOrEqual(416);expect(read!.height).toBeGreaterThan(60);expect(read!.y+read!.height).toBeLessThanOrEqual(send!.y);
  await page.evaluate(()=>{Object.defineProperties(visualViewport!,{height:{configurable:true,value:180},scale:{configurable:true,value:2}});visualViewport!.dispatchEvent(new Event('resize'));});
  expect(await page.locator('.app').evaluate(el=>el.getBoundingClientRect().height)).toBe(360);
  await page.setViewportSize({width:844,height:390});
  await page.evaluate(()=>{Object.defineProperties(visualViewport!,{height:{configurable:true,value:390},offsetTop:{configurable:true,value:0},scale:{configurable:true,value:1}});window.dispatchEvent(new Event('orientationchange'));});
  await expect(page.getByRole('button',{name:'发送',exact:true})).toBeInViewport();expect(await page.locator('.reader').evaluate(el=>el.clientHeight)).toBeGreaterThan(60);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/'+(test.info().project.name||'edge')+'-mobile-landscape.png'});
});

networkTest('late older and incomplete downloads retain the last complete offline copy',async({page})=>{
  await game(page,'离线副本防回退');await page.getByRole('button',{name:'设置',exact:true}).click();
  const copyResponse=page.waitForResponse('**/offline');await page.getByRole('button',{name:'下载此存档供离线阅读',exact:true}).click();const original=await(await copyResponse).json();
  await expect(page.getByLabel('安装与离线阅读')).toContainText('已完整下载：离线副本防回退');const version=await page.locator('.pwa-tools code').innerText();
  await page.route('**/offline',route=>route.fulfill({json:{...original,downloadedAt:'2020-01-01T00:00:00.000Z'}}));
  await page.getByRole('button',{name:'下载此存档供离线阅读',exact:true}).click();await expect(page.locator('.notice')).toContainText('保留较新的完整离线副本');
  await page.unroute('**/offline');await page.route('**/offline',route=>route.fulfill({json:{...original,books:{}}}));
  await page.getByRole('button',{name:'下载此存档供离线阅读',exact:true}).click();await expect(page.locator('.notice')).toContainText('下载不完整');
  await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.locator('.pwa-tools code')).toHaveText(version);
});

test('an updated shell still serves a previous build immutable chunk while offline',async({page,context,browserName,baseURL})=>{
  const origin=browserName==='webkit'?await stoppableOrigin(baseURL!):null;
  try{
  await game(page,'旧页面资源',origin?.url||'/');await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByLabel('安装与离线阅读')).toContainText('离线应用资源已就绪');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;const cache=await caches.open('dayao-shell-previous-fixture');await cache.put('/_next/static/chunks/previous-test.js',new Response('previous-build-resource'));});
  if(origin)await origin.disconnect();else await context.setOffline(true);
  expect(await page.evaluate(async()=>await(await fetch('/_next/static/chunks/previous-test.js')).text())).toBe('previous-build-resource');
  }finally{await origin?.close();}
});

networkTest('a late generation response leaves the newly selected volume and its input untouched',async({page})=>{
  await page.setViewportSize({width:390,height:844});await game(page,'生成中的卷甲');
  let release:()=>void=()=>{},accepted=false;const delayed=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/turns',async route=>{const response=await route.fetch();accepted=true;await delayed;await route.fulfill({response});});
  await page.getByLabel('自由输入').fill('让沈彻进来');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>accepted).toBe(true);
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.getByLabel('卷册名').fill('继续阅读的卷乙');await page.getByRole('button',{name:'开始新故事'}).click();
  await expect(page.locator('.chapter-heading')).toContainText('继续阅读的卷乙');await page.getByLabel('自由输入').fill('卷乙的新决定');
  const response=page.waitForResponse('**/api/turns');release();await response;await page.waitForTimeout(600);
  await expect(page.locator('.chapter-heading')).toContainText('继续阅读的卷乙');await expect(page.getByLabel('自由输入')).toHaveValue('卷乙的新决定');await expect(page.locator('.story-turn')).toHaveCount(1);
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.locator('.save-list').getByRole('button',{name:/生成中的卷甲/}).click();
  await expect(page.locator('.story-turn')).toHaveCount(2);await expect(page.getByLabel('自由输入')).toHaveValue('');
  await expect(page.locator('.request-recovery')).toHaveCount(0);
});

test('PWA update waits while a submitted request has no confirmed response even with empty input',async({page})=>{
  await page.addInitScript(()=>{
    const fetch=window.fetch.bind(window);
    window.fetch=async(...args:Parameters<typeof fetch>)=>{const response=await fetch(...args);if(args[0]==='/api/turns')await new Promise(()=>{});return response;};
  });
  await game(page,'未知请求更新保护');await page.getByLabel('自由输入').fill('让沈彻进来');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.request-recovery')).toBeVisible();await page.getByLabel('自由输入').fill('');
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByLabel('安装与离线阅读')).toContainText('离线应用资源已就绪');
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js?pending-fixture=1',{scope:'/',updateViaCache:'none'});});
  await expect(page.getByText('有新版本可用',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'保存就绪后更新应用'})).toBeDisabled();
});

networkTest('a completion poll cannot cancel an in-progress volume navigation',async({page})=>{
  await game(page,'轮询卷甲');
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.getByLabel('卷册名').fill('轮询卷乙');await page.getByRole('button',{name:'开始新故事'}).click();
  await expect(page.locator('.chapter-heading')).toContainText('轮询卷乙');
  const boot=await(await page.request.get('/api/bootstrap')).json(),id=boot.saves.find((save:{title:string})=>save.title==='轮询卷乙').id;
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.locator('.save-list').getByRole('button',{name:/轮询卷甲/}).click();
  let complete=false,polls=0;
  await page.route('**/api/drafts/*',async route=>{const response=await route.fetch(),draft=await response.json();polls++;await route.fulfill({json:{...draft,status:complete?'committed':'generating'}});});
  await page.getByLabel('自由输入').fill('让沈彻进来');await page.getByRole('button',{name:'发送',exact:true}).click();await expect.poll(()=>polls).toBeGreaterThan(0);
  let release:()=>void=()=>{},requested=false;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/saves/'+id,async route=>{requested=true;await gate;await route.continue();});
  await page.getByRole('button',{name:'存档',exact:true}).click();await page.locator('.save-list').getByRole('button',{name:/轮询卷乙/}).click();await expect.poll(()=>requested).toBe(true);
  complete=true;await expect(page.locator('.notice')).toContainText('正文与记忆已一起保存');
  release();await expect(page.locator('.chapter-heading')).toContainText('轮询卷乙');await expect(page.locator('.story-turn')).toHaveCount(1);
});

networkTest('phone can configure native Google Gemma when existing profiles contain no Google entry',async({page})=>{
  let modelCalls=0;page.on('request',request=>{if(/\/api\/(providers\/|turns(?:\/|$))/.test(request.url()))modelCalls++;});
  await page.route('**/api/bootstrap',async route=>{const response=await route.fetch(),boot=await response.json();await route.fulfill({json:{...boot,profiles:boot.profiles.filter((p:{provider:string})=>p.provider!=='google-gemma')}});});
  await page.setViewportSize({width:390,height:844});await game(page,'手机Gemma配置');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'增加配置',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'编辑模型配置'});
  await dialog.getByLabel('配置名称',{exact:true}).fill('手机原生Gemma配置');await dialog.getByLabel(/^供应商/).selectOption('google-gemma');
  await expect(dialog.getByLabel('模型 ID',{exact:true})).toHaveValue('gemma-4-26b-a4b-it');await expect(dialog.getByLabel('API Key',{exact:true})).toBeVisible();
  await expect(dialog).toContainText('无需 OpenAI Key');
  const saved=page.waitForResponse(response=>response.url().endsWith('/api/profiles')&&response.request().method()==='POST');await dialog.getByRole('button',{name:'保存配置与密钥',exact:true}).click();expect((await saved).ok()).toBe(true);
  const boot=await(await page.request.get('/api/bootstrap')).json();expect(boot.profiles.find((p:{label:string})=>p.label==='手机原生Gemma配置')).toMatchObject({provider:'google-gemma',model:'gemma-4-26b-a4b-it',hasKey:false});expect(modelCalls).toBe(0);
});
