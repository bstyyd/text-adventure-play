import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const fixtures=[
  {label:'硅基流动',provider:'siliconflow',origin:'https://api.siliconflow.cn',model:'Qwen/Qwen3-8B',list:true},
  {label:'DeepSeek 官方',provider:'deepseek',origin:'https://api.deepseek.com',model:'deepseek-flash',list:false},
  {label:'Google AI · Gemma',provider:'google-gemma',origin:'https://generativelanguage.googleapis.com',model:'gemma-4-26b-a4b-it',list:true},
];

// Keep native browser fetch: replacing it with a JS stub hides Window receiver bugs.
// Only intercept the transport, with a fake key and no billable upstream calls.
for(const fixture of fixtures)test('native browser provider connection: '+fixture.provider,async({page})=>{
  const requests:{method:string;url:string}[]=[],secret='browser-transport-fixture';
  await page.route(fixture.origin+'/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    requests.push({method:request.method(),url:request.url()});
    expect(request.headers()[fixture.provider==='google-gemma'?'x-goog-api-key':'authorization']).toBe(fixture.provider==='google-gemma'?secret:'Bearer '+secret);
    let result:unknown;
    if(request.method()==='GET'){
      expect(url.pathname).toBe(fixture.provider==='google-gemma'?'/v1beta/models':'/v1/models');
      result=fixture.provider==='google-gemma'?{models:[{name:'models/'+fixture.model,supportedGenerationMethods:['generateContent']}]}:{data:[{id:fixture.model}]};
    }else{
      expect(request.method()).toBe('POST');
      expect(url.pathname).toBe(fixture.provider==='google-gemma'?'/v1beta/models/'+fixture.model+':generateContent':fixture.provider==='siliconflow'?'/v1/chat/completions':'/chat/completions');
      if(fixture.provider!=='google-gemma')expect(request.postDataJSON().model).toBe(fixture.model);
      result=fixture.provider==='google-gemma'?{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'连接正常。'}]}}]}:{choices:[{finish_reason:'stop',message:{content:'连接正常。'}}]};
    }
    await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(result)});
  });
  await page.goto('./');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:new RegExp(fixture.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();
  const settings=page.getByRole('dialog',{name:'编辑模型配置',exact:true});
  await settings.getByLabel('模型 ID',{exact:true}).fill(fixture.model);
  await settings.getByLabel('API Key',{exact:true}).fill(secret);
  await expect(settings.getByLabel('在此设备记住 API Key',{exact:true})).toBeChecked();
  await settings.getByRole('button',{name:'保存配置与密钥',exact:true}).click();
  await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
  await expect(page.getByText('模型配置已保存。',{exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();
  const savedRow=page.getByRole('button',{name:new RegExp(fixture.label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))});
  await expect(savedRow).toContainText('已记住密钥');await savedRow.click();
  await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
  if(fixture.list){
    await settings.getByRole('button',{name:'获取模型列表',exact:true}).click();
    await page.getByRole('dialog',{name:'确认模型请求',exact:true}).getByRole('button',{name:'确认发送',exact:true}).click();
    await expect(settings.locator('datalist option')).toHaveAttribute('value',fixture.model);
  }
  await settings.getByRole('button',{name:'测试连接',exact:true}).click();
  await page.getByRole('dialog',{name:'确认模型请求',exact:true}).getByRole('button',{name:'确认发送',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'连接测试结果',exact:true});
  await expect(preview).toContainText('连接正常。');
  await expect(preview).toContainText('真实 API 返回');
  expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);
  expect(requests.filter(r=>r.method==='GET')).toHaveLength(fixture.list?1:0);
});

for(const width of [390,1440])test('activate API for gameplay after configuration at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:844});
  if(width===390)await page.addInitScript(()=>{
    // Reproduce a slow IndexedDB completion callback after the lease row has
    // already been cleared. A draft poll must wait rather than renew that lease.
    const releases=new WeakSet<IDBTransaction>(),put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(this.transaction.db.name==='interactive-fiction-pages-v1'&&key==='primary'&&value.version!==undefined&&!value.lease)releases.add(this.transaction);
      return put.call(this,value,key);
    };
    const complete=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete')!;
    Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...complete,set(listener:((this:IDBTransaction,event:Event)=>unknown)|null){
      complete.set!.call(this,listener?function(this:IDBTransaction,event:Event){
        if(releases.has(this))setTimeout(()=>listener.call(this,event),750);
        else listener.call(this,event);
      }:null);
    }});
  });
  const payloads:{model:string;stream:boolean;messages:{content:string}[]}[]=[],model='Qwen/Qwen3-8B';
  const prose='门外的书吏轻叩门框。\n\n“旧册已从库中取出，是否现在呈入？”他抱着卷册，在门边等候。';
  let rejectGeneration=false;
  await page.route('https://api.siliconflow.cn/**',async route=>{
    expect(route.request().headers().authorization).toBe('Bearer gameplay-key-fixture');
    const payload=route.request().postDataJSON();payloads.push(payload);expect(payload.model).toBe(model);
    if(rejectGeneration){await route.fulfill({status:401,contentType:'application/json',body:'{}'});return;}
    const extraction=payload.messages.some((m:{content:string})=>m.content.includes('EXTRACTOR v1'));
    const connection=payload.messages.at(-1).content.includes('不含剧情的连接测试');
    if(!connection)await new Promise(resolve=>setTimeout(resolve,75));
    const text=connection?'连接正常。':extraction?JSON.stringify({sceneProposal:null,facts:[],knowledgeProposals:[],relationshipEvidence:[],eventProposals:[],pendingThreads:[],suggestedActions:['询问卷册来自何处。','请来人说明经手过程。','先看一看封存记录。'],validationWarnings:[]}):prose;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:text}}]})});
  });
  await page.goto('./');await page.getByRole('button',{name:'翻开新篇',exact:true}).click();
  await page.getByLabel('卷册名',{exact:true}).fill('游戏模型切换 '+width);
  await page.getByRole('button',{name:'开始新故事',exact:true}).click();
  await page.getByLabel('自由输入',{exact:true}).fill('先等片刻');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.reader .story-turn')).toHaveCount(2,{timeout:30000});expect(payloads).toHaveLength(0);
  await expect(page.locator('.mock-note')).toContainText('不会调用 API');
  await page.getByRole('button',{name:'选择游戏模型',exact:true}).click();
  await page.getByRole('button',{name:/硅基流动.*请手动选择/}).click();
  const settings=page.getByRole('dialog',{name:'编辑模型配置',exact:true});
  await settings.getByLabel('模型 ID',{exact:true}).fill(model);
  await settings.getByLabel('API Key',{exact:true}).fill('gameplay-key-fixture');
  await settings.getByRole('button',{name:'保存配置与密钥',exact:true}).click();
  await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
  // Saving or testing a key alone must not silently change the active game model.
  await expect(page.getByLabel('正文配置')).toHaveValue('mock');
  if(width===1440){
    await settings.getByRole('button',{name:'测试连接',exact:true}).click();
    await page.getByRole('dialog',{name:'确认模型请求',exact:true}).getByRole('button',{name:'确认发送',exact:true}).click();
    const result=page.getByRole('dialog',{name:'连接测试结果',exact:true});
    await expect(result).toContainText('游戏当前使用 离线演练');expect(payloads).toHaveLength(1);
    await expect(page.getByLabel('正文配置')).toHaveValue('mock');
    await result.getByRole('button',{name:'用于游戏续写',exact:true}).click();
  }else await settings.getByRole('button',{name:'用于游戏续写',exact:true}).click();
  await expect(settings).not.toBeVisible();await expect(page.locator('.composer-foot')).toContainText('硅基流动 / '+model);
  await page.reload();await expect(page.locator('.composer-foot')).toContainText('硅基流动 / '+model);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(page.getByLabel('正文配置')).toHaveValue('siliconflow');
  await expect(page.getByLabel('记忆整理配置')).toHaveValue('same');
  await page.getByRole('button',{name:'故事',exact:true}).click();
  await page.getByLabel('自由输入',{exact:true}).fill('把册子拿来');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.reader .story-turn')).toHaveCount(3,{timeout:30000});
  await expect(page.locator('.reader .story-turn').nth(2)).toContainText(prose.split('\n')[0]);
  await expect(page.locator('.reader .story-turn').nth(2)).toContainText('siliconflow / '+model);
  await expect(page.locator('.reader .story-turn').nth(1)).toContainText('mock / mock-novel-v1');
  expect(payloads).toHaveLength(width===1440?3:2);expect(payloads.every(p=>p.stream===false)).toBe(true);
  if(width===1440){
    rejectGeneration=true;await page.getByLabel('自由输入',{exact:true}).fill('再核对一次');await page.getByRole('button',{name:'发送',exact:true}).click();
    await expect(page.locator('.reader .draft-card')).toContainText('密钥无效或已失效');
    await expect(page.locator('.reader .story-turn')).toHaveCount(3);expect(payloads).toHaveLength(4);
  }
});

test('remembered credentials stay out of story exports and can be cleared independently',async({page})=>{
  await page.goto('./');await page.getByRole('button',{name:'翻开新篇',exact:true}).click();
  await page.getByLabel('卷册名',{exact:true}).fill('本机密钥与故事分离');
  await page.getByRole('button',{name:'开始新故事',exact:true}).click();await expect(page.locator('.reader')).toContainText('门外传来脚步声');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:/DeepSeek 官方.*deepseek-flash/}).click();
  const settings=page.getByRole('dialog',{name:'编辑模型配置',exact:true}),secret='export-exclusion-key-fixture';
  await settings.getByLabel('API Key',{exact:true}).fill(secret);
  await settings.getByRole('button',{name:'保存配置与密钥',exact:true}).click();await expect(settings.getByLabel('API Key',{exact:true})).toHaveValue('');
  await settings.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'可恢复 JSON',exact:true}).click();
  expect(await readFile((await(await downloading).path())!,'utf8')).not.toContain(secret);
  const storyStorage=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('interactive-fiction-pages-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const row=await new Promise<{data:Uint8Array}>(resolve=>{const request=db.transaction('snapshots').objectStore('snapshots').get('primary');request.onsuccess=()=>resolve(request.result);});db.close();
    return new TextDecoder().decode(row.data)+JSON.stringify(localStorage);
  });expect(storyStorage).not.toContain(secret);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:/DeepSeek 官方.*已记住密钥/}).click();
  await settings.getByRole('button',{name:'清除这项密钥',exact:true}).click();await expect(page.getByText('已清除这项配置的本机密钥。',{exact:true})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(page.getByRole('button',{name:/DeepSeek 官方.*未配置密钥/})).toBeVisible();
  await page.getByRole('button',{name:'故事',exact:true}).click();await expect(page.locator('.reader')).toContainText('门外传来脚步声');
  const entries=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('interactive-fiction-provider-keys-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    const rows=await new Promise<unknown[]>(resolve=>{const request=db.transaction('keys').objectStore('keys').getAll();request.onsuccess=()=>resolve(request.result);});db.close();return rows;
  });expect(entries).toEqual([]);
});
