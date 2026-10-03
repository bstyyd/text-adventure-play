import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function start(page:Page,title:string){
  await page.goto('./');await expect(page.getByRole('button',{name:'翻开新篇',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'翻开新篇',exact:true}).click();await page.getByLabel('卷册名',{exact:true}).fill(title);
  await page.getByRole('button',{name:'开始新故事',exact:true}).click();await expect(page.locator('.reader')).toContainText('门外传来脚步声');
}
for(const width of [360,390,430,768,1440])test('Pages browser-only core and refresh at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:844});const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await start(page,'网页中文卷册 '+width);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const composer=page.getByLabel('自由输入',{exact:true});await composer.fill('让来人进来\n有事说事');await composer.press('Enter');await expect(composer).toHaveValue('让来人进来\n有事说事\n');
  await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.reader .story-turn')).toHaveCount(2,{timeout:30000});await expect(page.locator('.reader .draft-card')).toHaveCount(0);
  await page.reload();await expect(page.locator('.reader .story-turn')).toHaveCount(2);await expect(page.locator('.reader')).toContainText('有事说事');
  await page.getByRole('button',{name:'存档',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'可恢复 JSON',exact:true}).click();expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'往事',exact:true}).click();await expect(page.getByRole('heading',{name:'往事'})).toBeVisible();
  expect(errors).toEqual([]);
});
test('temporary player key never reaches storage and is forgotten on reload',async({page})=>{
  await page.goto('./');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:/DeepSeek 官方.*deepseek-flash/}).click();
  const secret='browser-only-fixture-secret';await page.getByLabel('API Key',{exact:true}).fill(secret);await page.getByLabel('在此设备记住 API Key',{exact:true}).uncheck();await page.getByRole('button',{name:'保存配置与密钥',exact:true}).click();await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
  const stored=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('interactive-fiction-pages-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const row=await new Promise<{data:Uint8Array}>(resolve=>{const r=db.transaction('snapshots').objectStore('snapshots').get('primary');r.onsuccess=()=>resolve(r.result);});db.close();
    return new TextDecoder().decode(row.data)+JSON.stringify(localStorage);
  });expect(stored).not.toContain(secret);
  await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByRole('button',{name:/DeepSeek 官方.*未配置密钥/})).toBeVisible();
});
test('downloaded resources open saved story offline with no model replay',async({page,context})=>{
  await start(page,'离线网页卷册');await page.getByRole('button',{name:'设置',exact:true}).click();
  await expect(page.getByText('离线应用资源已就绪。',{exact:false})).toBeVisible({timeout:45000});
  await context.setOffline(true);await page.reload();await expect(page.locator('.reader')).toContainText('门外传来脚步声',{timeout:30000});
  await expect(page.getByText('当前离线，联网后才能生成新内容。',{exact:false}).first()).toBeVisible();await page.getByRole('button',{name:'存档',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'可恢复 JSON',exact:true}).click();expect((await download).suggestedFilename()).toMatch(/\.json$/);
  await context.setOffline(false);
});
test('file import creates another save and other browsers cannot see the book',async({page,browser})=>{
  await start(page,'备份与隔离');await page.getByRole('button',{name:'存档',exact:true}).click();const exported=page.waitForEvent('download');await page.getByRole('button',{name:'可恢复 JSON',exact:true}).click();const download=await exported,content=await readFile((await download.path())!);
  await page.locator('input[type=file][accept=".json"]').setInputFiles({name:'手机备份.json',mimeType:'application/json',buffer:content});await expect(page.getByText('已创建导入存档，原档未改动。')).toBeVisible();await page.getByRole('button',{name:'存档',exact:true}).click();await expect(page.locator('.modal .save-list>div')).toHaveCount(2);
  const other=await browser.newContext();try{const second=await other.newPage();await second.goto(new URL('./',page.url()).href);await expect(second.getByRole('button',{name:'翻开新篇',exact:true})).toBeVisible();await second.getByRole('button',{name:'存档',exact:true}).click();await expect(second.locator('.modal .save-list>div')).toHaveCount(0);}finally{await other.close();}
});
test('quota failure keeps official history and permits exporting the old save',async({page})=>{
  await start(page,'空间不足旧档');await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(this.transaction.db.name==='interactive-fiction-pages-v1'&&key==='primary'&&value.data&&new TextDecoder().decode(value.data).includes('"status":"committed"'))throw new DOMException('fixture','QuotaExceededError');
      return original.call(this,value,key);
    };
  });
  await page.getByLabel('自由输入',{exact:true}).fill('让来人进来');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByText(/浏览器保存未完成|浏览器存储空间不足/).first()).toBeVisible({timeout:30000});await expect(page.locator('.reader .story-turn')).toHaveCount(1);
  await page.getByRole('button',{name:'存档',exact:true}).click();const exported=page.waitForEvent('download');await page.getByRole('button',{name:'可恢复 JSON',exact:true}).click();expect((await exported).suggestedFilename()).toMatch(/\.json$/);
});
