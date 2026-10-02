import {test,expect} from '@playwright/test';
for(const width of [360,1440])test('shared game saves, reloads and isolates players at '+width+'px',async({browser})=>{
  const a=await browser.newContext({baseURL:'http://127.0.0.1:3220',viewport:{width,height:900}}),b=await browser.newContext({baseURL:'http://127.0.0.1:3220'});
  try{
    const page=await a.newPage();await page.goto('/');
    await expect(page.getByRole('button',{name:'存档',exact:true})).toBeVisible();
    expect(await page.locator('body').evaluate(e=>e.scrollWidth<=window.innerWidth)).toBe(true);
    const session=await(await a.request.get('/api/session')).json(),headers={'x-dayao-csrf':session.csrf};
    expect(session.loginRequired).toBe(false);
    const result=await a.request.post('/api/saves',{headers,data:{title:'分享站存档 '+width}});expect(result.ok()).toBe(true);
    const save=await result.json(),view=await(await a.request.get('/api/saves/'+save.id)).json();
    const input={clientRequestId:crypto.randomUUID(),saveId:save.id,branchId:view.branch.id,expectedHeadTurnId:view.branch.headTurnId,playerText:'让门外来人进来',target:null,mode:'story'};
    expect((await a.request.post('/api/turns',{headers,data:input})).status()).toBe(202);
    await expect.poll(async()=>(await(await a.request.get('/api/requests/'+input.clientRequestId)).json()).draft?.status).toBe('committed');
    expect((await a.request.post('/api/turns',{headers,data:input})).status()).toBe(202);
    await page.reload();await page.getByRole('button',{name:'存档',exact:true}).click();
    await page.locator('.modal .save-list').getByRole('button',{name:new RegExp('分享站存档 '+width)}).click();
    await expect(page.getByText('让门外来人进来',{exact:true})).toBeVisible();
    const after=await(await a.request.get('/api/saves/'+save.id)).json();expect(after.turns).toHaveLength(2);
    await b.request.get('/api/session');expect((await(await b.request.get('/api/bootstrap')).json()).saves).toEqual([]);
    expect((await b.request.get('/api/saves/'+save.id)).ok()).toBe(false);
    expect((await b.request.get('/api/saves/'+save.id+'/export')).ok()).toBe(false);
    expect((await(await b.request.get('/api/requests/'+input.clientRequestId)).json()).draft).toBeNull();
    expect((await a.request.post('/api/profiles',{headers,data:{}})).status()).toBe(403);
    await page.getByRole('button',{name:'设置',exact:true}).click();
    await expect(page.getByText('本站模型由站长统一提供，无需填写 API Key。')).toBeVisible();
    await expect(page.getByLabel('API Key',{exact:true})).toHaveCount(0);
  }finally{await a.close();await b.close();}
});
test('deployment controls require the operations secret and preserve existing reads',async({request})=>{
  expect((await request.post('/api/ops/drain')).status()).toBe(403);
  const session=await(await request.get('/api/session')).json();
  const headers={'authorization':'Bearer fixture-deployment-operations-token-32chars'};
  expect((await request.post('/api/ops/drain',{headers})).ok()).toBe(true);
  expect((await request.get('/api/bootstrap')).ok()).toBe(true);
  expect((await request.post('/api/turns',{headers:{'x-dayao-csrf':session.csrf},data:{}})).status()).toBe(503);
  expect((await request.post('/api/ops/resume',{headers})).ok()).toBe(true);
});
