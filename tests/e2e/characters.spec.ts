import { test,expect } from '@playwright/test';
import { temporaryRepo,emptyExtraction,inputFor } from '../helpers';
import { TurnEngine } from '../../src/engine/engine';
import { MockProvider } from '../../src/llm/mock';
import { DEFAULT_PROFILES } from '../../src/llm/config';
import { exportSave } from '../../src/storage/transfer';
import type { Extraction,View } from '../../src/domain/types';
import type { TextRequest,TextResult } from '../../src/llm/types';
import type { CharacterBook } from '../../src/characters/schema';

test.beforeEach(async({page})=>{await page.addInitScript(()=>{window.prompt=()=>{throw Error('unsupported');};window.confirm=()=>{throw Error('unsupported');};});});
async function begin(page:import('@playwright/test').Page,title:string){
  await page.goto('/');await page.getByRole('button',{name:'存档',exact:true}).click();await page.getByLabel('卷册名').fill(title);
  await page.getByRole('button',{name:'开始新故事'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function send(page:import('@playwright/test').Page,text:string){
  await page.getByLabel('自由输入').fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.story-turn .player-line').last()).toContainText(text);await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);
}
test('mobile character book registers a speaker, follows without story changes, searches and opens original text',async({page})=>{
  await page.setViewportSize({width:390,height:844});await begin(page,'动态人物手机验收');
  await send(page,'请军需吏陆衡进来');await send(page,'陆衡，说明经手事项。');
  await expect(page.getByLabel('交谈对象')).toContainText('陆衡');
  await page.getByRole('button',{name:'人物簿',exact:true}).click();await expect(page.locator('.character-list>button')).toHaveCount(7);
  await page.getByLabel('搜索人物').fill('陆衡');await expect(page.locator('.character-list>button')).toHaveCount(1);
  await page.getByRole('button',{name:/查看人物 陆衡/}).click();
  await expect(page.getByRole('heading',{name:'陆衡',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'人物详情'})).toContainText('所在地：御书房');
  await expect(page.getByRole('progressbar')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  let turns=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/turns'))turns++;});
  await page.getByRole('button',{name:'关注人物',exact:true}).click();await expect(page.getByRole('button',{name:'取消关注',exact:true})).toBeEnabled();
  expect(turns).toBe(0);await page.screenshot({path:'artifacts/character-mobile-detail.png',fullPage:true});
  await page.getByText('人物路线设置',{exact:true}).click();await expect(page.locator('.character-detail')).toContainText('未开放恋爱线');
  await page.getByRole('button',{name:'明确开放恋爱线'}).click();await expect(page.locator('.character-page').getByRole('alert')).toContainText('年龄未知');
  await page.getByRole('button',{name:'首次登场原文'}).click();await expect(page.locator('.story-turn')).toHaveCount(3);
  await expect(page.locator('.story-turn').nth(1)).toContainText('陆衡走进御书房');
  await page.getByRole('button',{name:'人物簿',exact:true}).click();await page.getByLabel('人物分组').selectOption('follow');
  await expect(page.locator('.character-list>button')).toHaveCount(7);await page.screenshot({path:'artifacts/character-mobile-book.png',fullPage:true});
  await page.reload();await page.getByRole('button',{name:'人物簿',exact:true}).click();await page.getByRole('button',{name:/查看人物 陆衡/}).click();
  await expect(page.getByRole('button',{name:'取消关注',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'返回人物簿'}).click();await expect(page.getByLabel('搜索人物')).toBeVisible();
});

test('old-node character book and a correction branch exclude the future individual',async({page})=>{
  await begin(page,'人物旧节点验收');await send(page,'请军需吏陆衡进来');
  await page.getByRole('button',{name:'往事',exact:true}).click();await page.getByRole('button',{name:'查看当时状态',exact:true}).first().click();
  await page.getByRole('button',{name:'查看当时人物簿'}).click();await expect(page.locator('.character-page')).toContainText('当时人物档案');
  await expect(page.locator('.character-list>button')).toHaveCount(6);await page.getByLabel('搜索人物').fill('陆衡');await expect(page.locator('.character-list>button')).toHaveCount(0);
  await page.getByRole('button',{name:'人物簿',exact:true}).click();await page.getByRole('button',{name:/查看人物 陆衡/}).click();
  await page.locator('.character-correction summary').click();await page.getByLabel('人物更正说明').fill('此处应先问来意，再辨认身份。');
  await page.getByRole('button',{name:'从来源前分支修订'}).click();await expect(page.locator('.story-turn')).toHaveCount(1);
  await expect(page.getByLabel('自由输入')).toHaveValue('请军需吏陆衡进来');
  await page.getByRole('button',{name:'人物簿',exact:true}).click();await expect(page.locator('.character-list>button')).toHaveCount(6);
  await page.getByRole('button',{name:'往事',exact:true}).click();await page.getByText('回看分支').locator('select').selectOption({label:'正篇'});
  await expect(page.locator('.history-card')).toHaveCount(2);await expect(page.locator('.history-card').last()).toContainText('陆衡');
});

class CharacterFixture extends MockProvider {
  body='';extraction:Extraction=emptyExtraction();
  override async generateText(r:TextRequest):Promise<TextResult>{r.onAttempt?.();return {text:r.system.startsWith('EXTRACTOR')?JSON.stringify(this.extraction):this.body,finishReason:'stop',usage:{input:0,output:0},requestCount:1,requestId:null};}
}
test('HTTP projections, browser storage and historical search exclude private identity data',async({page})=>{
  // A real engine and isolated SQLite database create the fixture; no upstream request is made.
  const repo=temporaryRepo(),save=repo.createSave({title:'人物可见性验收'}),provider=new CharacterFixture();
  let archive:string;
  try{
    const engine=new TurnEngine(repo,{provider:()=>provider,secret:()=>'',profiles:()=>({narrator:DEFAULT_PROFILES[0],extractor:DEFAULT_PROFILES[0]})});
    provider.body='军需吏陆衡在廊外等候。';
    provider.extraction={...emptyExtraction(),proposedCharacterCreations:[{draftRef:'new:visitor',name:'陆衡',referenceName:'陆衡',identity:'军需吏',identityStatus:'confirmed',roleInStory:'说明经手事项',motivation:'私密身份哨兵乙七',relevance:'supporting',presence:'mentioned',location:null,evidence:{blockId:'b0',quote:provider.body},revealed:true,knownBy:[]}]};
    const first=engine.start(inputFor(repo,save.id,'等候说明。'));await engine.wait(first.id);expect(repo.draft(first.id).status).toBe('committed');
    const id=repo.view(save.id).turns.at(-1)!.effects.characters![0].id;
    provider.body='核过籍册，陆衡的真名确为周衡。';
    provider.extraction={...emptyExtraction(),proposedCharacterChanges:[{ref:'name',characterId:id,field:'name',value:'周衡',operation:'set',certainty:'confirmed',actorId:null,reason:'核对籍册',knownBy:[],revealed:true,evidence:{blockId:'b0',quote:provider.body}}]};
    const second=engine.start(inputFor(repo,save.id,'核对籍册。'));await engine.wait(second.id);expect(repo.draft(second.id).status).toBe('committed');
    provider.body='来信出自未署名写信人。';
    provider.extraction={...emptyExtraction(),proposedCharacterCreations:[{draftRef:'new:unseen',name:'隐名哨兵丁九',referenceName:'未署名写信人',identity:'疑为内廷密使',identityStatus:'suspicion',roleInStory:'来信来源待查',motivation:null,relevance:'supporting',presence:'hidden',location:null,evidence:{blockId:'b0',quote:provider.body},revealed:false,knownBy:[]}]};
    const third=engine.start(inputFor(repo,save.id,'收好来信。'));await engine.wait(third.id);expect(repo.draft(third.id).status).toBe('committed');
    archive=JSON.stringify(exportSave(repo,save.id));expect(archive).toContain('私密身份哨兵乙七');
  }finally{repo.close();}
  await page.goto('/');await expect(page.getByRole('button',{name:'存档',exact:true})).toBeVisible();
  const session=await (await page.request.get('/api/session')).json();
  const imported=await page.request.post('/api/saves/import',{headers:{'x-dayao-csrf':session.csrf},data:{archive}});expect(imported.ok()).toBe(true);
  const importedSave=await imported.json();await page.reload();
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.locator('.save-list>div').filter({hasText:'人物可见性验收'}).getByRole('button').first().click();
  const viewRes=await page.request.get('/api/saves/'+importedSave.id),view=await viewRes.json() as View;
  expect(JSON.stringify(view)).not.toContain('私密身份哨兵乙七');expect(viewRes.headers()['cache-control']).toBe('no-store');
  expect(JSON.stringify(view)).not.toContain('隐名哨兵丁九');
  const prefix='/api/saves/'+importedSave.id+'/characters?branch='+view.branch.id;
  const current=await (await page.request.get(prefix)).json() as CharacterBook;
  expect(JSON.stringify(current)).not.toContain('私密身份哨兵乙七');expect(current.characters.find(c=>c.name==='周衡')?.aliases).toContain('陆衡');
  expect(JSON.stringify(current)).not.toContain('隐名哨兵丁九');expect(current.characters).toHaveLength(7);
  const then=await (await page.request.get(prefix+'&at='+view.turns[1].id)).json();expect(JSON.stringify(then)).not.toContain('周衡');
  const hiddenSearch=await (await page.request.get(prefix+'&q='+encodeURIComponent('私密身份哨兵乙七'))).json();expect(hiddenSearch.characters).toHaveLength(0);
  const hiddenIdentity=await (await page.request.get(prefix+'&q='+encodeURIComponent('隐名哨兵丁九'))).json();expect(hiddenIdentity.characters).toHaveLength(0);
  const futureSearch=await (await page.request.get(prefix+'&at='+view.turns[1].id+'&q='+encodeURIComponent('周衡'))).json();expect(futureSearch.characters).toHaveLength(0);
  const preview=await (await page.request.get('/api/saves/'+importedSave.id+'/context?input='+encodeURIComponent('问周衡'))).text();expect(preview).not.toMatch(/私密身份哨兵乙七|隐名哨兵丁九/);
  await page.getByRole('button',{name:'人物簿',exact:true}).click();await page.getByLabel('搜索人物').fill('周衡');
  await expect(page.locator('.character-list>button')).toHaveCount(1);await page.getByRole('button',{name:/查看人物 周衡/}).click();
  await page.screenshot({path:'artifacts/character-desktop.png',fullPage:true});
  expect(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).not.toMatch(/私密身份哨兵乙七|隐名哨兵丁九/);
  const stored=await page.evaluate(async()=>new Promise<unknown[]>((resolve,reject)=>{const r=indexedDB.open('dayao-browser-v1');r.onsuccess=()=>{const read=r.result.transaction('records').objectStore('records').getAll();read.onsuccess=()=>{resolve(read.result);r.result.close();};read.onerror=()=>reject(read.error);};r.onerror=()=>reject(r.error);}));
  expect(JSON.stringify(stored)).not.toMatch(/私密身份哨兵乙七|隐名哨兵丁九/);
  const cached=await page.evaluate(async()=>{const keys=await caches.keys();return (await Promise.all(keys.map(async key=>(await(await caches.open(key)).keys()).map(r=>r.url)))).flat();});
  expect(cached.some(url=>new URL(url).pathname.startsWith('/api/'))).toBe(false);
});
