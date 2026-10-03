import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { DEFAULT_PROFILES } from '../../src/llm/config';
import path from 'node:path';
import { Repository } from '../../src/storage/repository';
import { emptyExtraction,putLegacyDraft } from '../helpers';
const prose='殿门推开。沈彻走进御书房，在案前三步处站定。\n\n沈彻抱拳道：“北边出了事，细情尚待查证。”';
async function failedDraft(page:Page,title:string,playerText='看看来的人是谁，让对方进来',hasExtraction=false){
  await page.goto('/');await expect(page.getByRole('button',{name:'存档',exact:true})).toBeVisible();const {csrf}=await (await page.request.get('/api/session')).json();
  const post=async(path:string,data:unknown)=>{const r=await page.request.post('/api/'+path,{data,headers:{'x-dayao-csrf':csrf}});expect(r.ok(),path+': '+(r.ok()?'':await r.text())).toBe(true);return r.json();};
  await post('settings',{narrator:'mock',extractor:'same',style:'克制，留白，以对白与动作推进。'});
  const save=await post('saves',{title}),view=await (await page.request.get('/api/saves/'+save.id)).json();
  // Seed a legacy failure only in the isolated E2E database; there is no production fixture endpoint.
  const boot=await(await page.request.get('/api/bootstrap')).json(),dir=path.resolve(boot.dataDir);
  expect(path.dirname(dir)).toBe(path.resolve('.test-data'));expect(path.basename(dir)).toMatch(/^e2e-/);
  const repo=new Repository(dir,{recoverDrafts:false});let d;
  try{
    const x=emptyExtraction(),state=view.turns.at(-1).state;
    x.sceneProposal={minutes:1,location:state.location,present:['shen_che'],weather:'春寒，夜静',evidence:{blockId:'b1',quote:prose.split('\n\n')[0]}};
    x.facts=[{kind:'claim',subject:'shen_che',content:'沈彻报告北边出了事，细情尚待查证。',knownBy:['shen_che'],revealed:true,importance:3,evidence:{blockId:'b2',quote:'北边出了事，细情尚待查证。'}}];
    x.eventProposals=[{key:'北边出事',status:'introduced',evidence:{blockId:'b2',quote:'北边出了事，细情尚待查证。'}}];x.pendingThreads=['等待军报详情。'];
    d=putLegacyDraft(repo,save.id,playerText,'她脑子里先跳出来一个数字。\n\n'+prose,hasExtraction?x:null);
  }finally{repo.close();}
  // Refresh restores the last read save. Explicitly open this newly created fixture.
  await page.reload();await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.locator('.save-list>div').filter({hasText:title}).getByRole('button').first().click();
  await expect(page.locator('.chapter-heading')).toContainText(title);
  return {draftId:d.id,saveId:save.id,post};
}
test.beforeEach(async({page})=>{await page.addInitScript(()=>{window.prompt=()=>{throw Error('unsupported');};window.confirm=()=>{throw Error('unsupported');};});});
test('mobile local review validates then commits and persists the actual draft with original-text history',async({page})=>{
  await page.setViewportSize({width:390,height:844});const fixture=await failedDraft(page,'本地审阅手机验收');await page.reload();
  await expect(page.locator('.draft-card')).toContainText('玄天华');
  let modelActions=0;page.on('request',r=>{if(r.method()==='POST'&&/\/(turns|retry|suggestions)$/.test(r.url()))modelActions++;});
  await page.getByText('更多处理',{exact:true}).click();
  await page.getByText('手动整理记忆（高级补救）',{exact:true}).click();
  await page.getByRole('button',{name:'本地审阅并保存',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'本地审阅并保存'});
  await expect(dialog.getByRole('button',{name:'校验并保存为正式剧情'})).toBeDisabled();
  await dialog.getByLabel('本地审阅正文').fill(prose);
  await dialog.getByLabel('在场：沈彻',{exact:true}).check();
  // Manual recovery is optional and needs real memory, but no extra confirmation checkbox.
  await expect(dialog.getByLabel('我已核对正文完整',{exact:false})).toHaveCount(0);
  const saveButton=dialog.getByRole('button',{name:'校验并保存为正式剧情'});
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAccessibleDescription(/请点击“添加记忆”，至少记录一项本节进展/);
  await dialog.getByRole('status').scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('status')).toBeInViewport();
  await page.screenshot({path:'artifacts/draft-review-missing-memory-mobile.png',fullPage:true});
  await dialog.getByRole('button',{name:'添加记忆'}).click();
  await expect(dialog.getByLabel('记忆内容 1',{exact:true})).toBeFocused();
  await dialog.getByLabel('记忆内容 1',{exact:true}).fill('   ');
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveAccessibleDescription(/请填写每项记忆的内容/);
  await dialog.getByLabel('记忆内容 1',{exact:true}).fill('沈彻报告北边出了事，细情尚待查证。');
  await expect(saveButton).toBeEnabled();
  await dialog.getByLabel('记忆 1 来源',{exact:true}).selectOption('b1');
  await dialog.getByLabel('记忆 1 知情：沈彻',{exact:true}).check();
  await dialog.getByLabel('记忆 1 来源逐字引文',{exact:true}).fill('假引文不在正文');
  await dialog.getByRole('button',{name:'校验并保存为正式剧情'}).click();
  await expect(dialog.getByRole('alert')).toContainText('证据');
  const failed=await (await page.request.get('/api/drafts/'+fixture.draftId)).json();expect(failed.status).toBe('failed');expect(failed.body).toContain('她脑子里');
  await dialog.getByLabel('记忆 1 来源逐字引文',{exact:true}).fill('北边出了事，细情尚待查证。');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:'artifacts/draft-local-review-mobile.png',fullPage:true});
  await dialog.getByRole('button',{name:'校验并保存为正式剧情'}).click();
  await expect(dialog).toHaveCount(0);await expect(page.locator('.draft-card')).toHaveCount(0);
  await expect(page.locator('.story-turn')).toHaveCount(2);await expect(page.locator('.story-turn').last()).toContainText('记忆经本地审阅');
  expect(modelActions).toBe(0);
  await page.reload();await expect(page.locator('.story-turn').last()).toContainText(prose.split('\n\n')[1]);
  const view=await (await page.request.get('/api/saves/'+fixture.saveId)).json();expect(view.turns.at(-1).state.present).toEqual(['shen_che']);expect(view.turns.at(-1).effects.memories).toHaveLength(1);
  await page.getByRole('button',{name:'往事',exact:true}).click();
  await expect(page.locator('.history-card')).toHaveCount(2);await expect(page.locator('.history-card').last()).toContainText(prose.split('\n\n')[1]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('wording hints do not block manual editing and the current extractor is used',async({page})=>{
  await page.setViewportSize({width:584,height:958});
  const fixture=await failedDraft(page,'模型切换重试验收','让沈彻进来');
  // Both profiles are Mock; this tests routing and UI consent, never a paid provider.
  const changed={...DEFAULT_PROFILES[0],id:'review-replacement',label:'测试整理配置',model:'mock-replacement',timeoutMs:120000};
  await fixture.post('profiles',{profile:changed,key:''});await fixture.post('settings',{narrator:'mock',extractor:changed.id,style:'克制，留白，以对白与动作推进。'});
  await page.reload();
  await page.getByText('更多处理',{exact:true}).click();
  await expect(page.locator('.recovery-note')).toContainText('mock-replacement');
  await page.getByText('调整重试模型与等待时间',{exact:true}).click();
  await page.getByLabel('此次记忆整理模型').selectOption(changed.id);await page.getByLabel('此次整理等待 / 秒').fill('240');
  await page.screenshot({path:'artifacts/draft-retry-model.png',fullPage:true});
  let retryRequests=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/retry'))retryRequests++;});
  await expect(page.getByRole('button',{name:'重试整理并自动保存',exact:true})).toBeEnabled();
  await expect(page.getByRole('region',{name:'正文参考提示'})).toContainText('她脑子里先跳出来一个数字。');
  expect(retryRequests).toBe(0);
  await expect(page.locator('.draft-card .error-text')).toContainText('玄天华');
  const actual=await (await page.request.get('/api/drafts/'+fixture.draftId)).json();
  expect(actual.body).toBe('她脑子里先跳出来一个数字。\n\n'+prose);expect(actual.requestCount).toBe(0);
  // The player may keep or revise the wording; there is no mandatory wording approval.
  await page.getByRole('button',{name:'核对／修订正文',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('mock-replacement');
  await expect(page.getByRole('button',{name:'保存修改并自动整理'})).toBeEnabled();
  await page.getByRole('dialog').getByRole('button',{name:'定位第 1 处'}).click();
  const selected=await page.getByLabel('核对草稿正文').evaluate((el:HTMLTextAreaElement)=>el.value.slice(el.selectionStart,el.selectionEnd));
  expect(selected).toBe('她脑子里先跳出来一个数字。');
  await page.getByLabel('核对草稿正文').fill(prose);
  const request=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/retry'));
  await page.getByRole('button',{name:'保存修改并自动整理'}).click();
  expect((await request).postDataJSON()).toEqual({extractOnly:true,body:prose,extractProfileId:changed.id});
  await expect(page.locator('.draft-card')).toHaveCount(0);await expect(page.locator('.story-turn')).toHaveCount(2);
  const committed=await (await page.request.get('/api/drafts/'+fixture.draftId)).json();expect(committed.extractProfile.model).toBe('mock-replacement');expect(retryRequests).toBe(1);
});

test('one repair click retains the original and automatically saves a valid revision without review dialogs',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const fixture=await failedDraft(page,'正文一键修正验收','让沈彻进来');
  let repairs=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/repair'))repairs++;});
  await expect(page.getByRole('button',{name:'重试整理并自动保存',exact:true})).toBeEnabled();
  await page.getByText('更多处理',{exact:true}).click();
  await expect(page.getByRole('region',{name:'正文参考提示'})).toContainText('她脑子里先跳出来一个数字。');
  await page.getByText('可选：让模型修正文',{exact:true}).click();
  await page.getByRole('button',{name:'自动修正并保存',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/body-repair-mobile.png',fullPage:true});
  expect(repairs).toBe(0);
  await page.getByRole('button',{name:'自动修正并保存',exact:true}).click();
  await expect(page.locator('.draft-card')).toHaveCount(0);
  await expect(page.locator('.story-turn')).toHaveCount(2);await expect(page.getByRole('dialog')).toHaveCount(0);
  const d=await (await page.request.get('/api/drafts/'+fixture.draftId)).json();
  expect(d.status).toBe('committed');expect(d.body).toBe(prose);expect(d.bodyRepair.originalBody).toBe('她脑子里先跳出来一个数字。\n\n'+prose);
  expect(d.requestCount).toBe(2);expect(repairs).toBe(1);
  await page.reload();await expect(page.locator('.story-turn').last()).toContainText('北边出了事');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('mobile local save keeps player-selected prose and resolves legacy summary fields with zero model requests',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const fixture=await failedDraft(page,'玩家决定正文与本地保存','看看来的人是谁，让对方进来',true);
  let modelCalls=0,localSaves=0;
  page.on('request',r=>{if(r.method()==='POST'){if(/\/(retry|repair|turns|revise|suggestions)$/.test(r.url()))modelCalls++;if(r.url().endsWith('/save'))localSaves++;}});
  await page.getByText('更多处理',{exact:true}).click();
  await expect(page.getByRole('region',{name:'正文参考提示'})).toContainText('不阻止保存');
  const save=page.getByRole('button',{name:'保存这段剧情',exact:true});await expect(save).toBeEnabled();
  await save.scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/player-decides-local-save-mobile.png',fullPage:true});
  await save.click();await expect(page.locator('.draft-card')).toHaveCount(0);await expect(page.locator('.story-turn')).toHaveCount(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(modelCalls).toBe(0);expect(localSaves).toBe(1);
  await page.locator('.story-notes summary').click();await expect(page.locator('.story-notes')).toContainText('是否修改由你决定');
  await expect(page.locator('.story-notes')).toContainText('已沿用上一节天气');await expect(page.locator('.story-turn').last()).toContainText('她脑子里先跳出来一个数字。');
  const d=await(await page.request.get('/api/drafts/'+fixture.draftId)).json();expect(d.status).toBe('committed');expect(d.requestCount).toBe(0);
  const view=await(await page.request.get('/api/saves/'+fixture.saveId)).json();expect(view.turns.at(-1).state.weather).toBe(view.turns[0].state.weather);expect(view.turns.at(-1).effects.memories).toHaveLength(1);
  await page.reload();await expect(page.locator('.story-turn').last()).toContainText('她脑子里先跳出来一个数字。');
  await page.getByRole('button',{name:'修改第1节'}).click();await expect(page.getByLabel('修订正式正文')).toHaveValue(/她脑子里/);await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'往事',exact:true}).click();await expect(page.locator('.history-card').last()).toContainText('她脑子里');expect(modelCalls).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('a legacy wording-only failure can retry unchanged and autosave with no approval dialog',async({page})=>{
  await page.setViewportSize({width:360,height:844});const fixture=await failedDraft(page,'措辞保留直接自动保存','让沈彻进来');
  let retries=0,repairs=0;page.on('request',r=>{if(r.method()==='POST'){if(r.url().endsWith('/retry'))retries++;if(r.url().endsWith('/repair'))repairs++;}});
  await page.getByRole('button',{name:'重试整理并自动保存',exact:true}).click();
  await expect(page.locator('.draft-card')).toHaveCount(0);await expect(page.locator('.story-turn')).toHaveCount(2);await expect(page.getByRole('dialog')).toHaveCount(0);
  const d=await(await page.request.get('/api/drafts/'+fixture.draftId)).json();expect(d.body).toBe('她脑子里先跳出来一个数字。\n\n'+prose);expect(d.requestCount).toBe(1);expect(retries).toBe(1);expect(repairs).toBe(0);
  await page.locator('.story-notes summary').click();await expect(page.locator('.story-notes')).toContainText('不要求逐条确认');
  await page.screenshot({path:'artifacts/player-decides-saved-mobile.png',fullPage:true});
  await page.reload();await expect(page.locator('.story-turn').last()).toContainText('她脑子里');
});
