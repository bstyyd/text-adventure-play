import { test,expect } from '@playwright/test';
test('LAN login protects every data route and costs; logout revokes access',async({page})=>{
  await page.goto('/');await expect(page.getByRole('heading',{name:'个人书库'})).toBeVisible();
  expect((await page.request.get('/api/bootstrap')).status()).toBe(401);
  for(const path of ['/api/scenarios','/api/scenarios/dayao_empress','/api/scenarios/dayao_empress/export'])expect((await page.request.get(path)).status()).toBe(401);
  expect((await page.request.get('/api/saves/00000000-0000-4000-8000-000000000000/export')).status()).toBe(401);
  const repairPath='/api/drafts/00000000-0000-4000-8000-000000000000/repair',guest=await(await page.request.get('/api/session')).json();
  expect((await page.request.post(repairPath,{headers:{'x-dayao-csrf':guest.csrf},data:{}})).status()).toBe(401);
  const savePath=repairPath.replace('/repair','/save');
  expect((await page.request.post(savePath,{headers:{'x-dayao-csrf':guest.csrf},data:{revision:'0'.repeat(64)}})).status()).toBe(401);
  for(const path of ['manual','preview','assist','import','install','delete','compare','upgrade'])expect((await page.request.post('/api/scenarios/'+path,{headers:{'x-dayao-csrf':guest.csrf},data:{}})).status()).toBe(401);
  await page.getByLabel('登录口令').fill('fixture-private-password');await page.getByRole('button',{name:'登录',exact:true}).click();
  await expect(page.getByRole('button',{name:'存档',exact:true})).toBeVisible();
  const session=await(await page.request.get('/api/session')).json(),headers={'x-dayao-csrf':session.csrf};
  expect((await page.request.post('/api/saves',{data:{title:'未经CSRF'}})).status()).toBe(403);
  expect((await page.request.post(repairPath,{data:{}})).status()).toBe(403);
  expect((await page.request.post(savePath,{data:{revision:'0'.repeat(64)}})).status()).toBe(403);
  expect((await page.request.get('/api/scenarios')).ok()).toBe(true);expect((await page.request.post('/api/scenarios/manual',{data:{title:'缺少CSRF'}})).status()).toBe(403);
  const result=await page.request.post('/api/saves',{headers,data:{title:'受保护主存档'}});expect(result.ok()).toBe(true);
  const save=await result.json();expect((await page.request.get('/api/saves/'+save.id)).ok()).toBe(true);
  for(let i=0;i<12;i++){const res=await page.request.post(i%2?'/api/providers/test':repairPath,{headers,data:{}});expect(res.status()).toBe(400);}
  expect((await page.request.post(repairPath,{headers,data:{}})).status()).toBe(429);
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('heading',{name:'个人书库'})).toBeVisible();
  expect((await page.request.get('/api/bootstrap')).status()).toBe(401);
});
