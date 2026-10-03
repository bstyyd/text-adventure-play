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
  const preview=page.getByRole('dialog',{name:'记忆与来源预览',exact:true});
  await expect(preview).toContainText('连接正常。');
  await expect(preview).toContainText('真实 API 返回');
  expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);
  expect(requests.filter(r=>r.method==='GET')).toHaveLength(fixture.list?1:0);
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
