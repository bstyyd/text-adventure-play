import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

// Exercise real browser storage and fetch with isolated fake upstream responses.
// No user keys or paid requests are used by these tests.
for(const width of [320,375,414,768])test('compact chat autosave and recovery at '+width+'px',async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  let calls=0,invalid=false;
  const prose='窗纸被夜风轻轻吹动。\n\n门外的脚步声停了，来人仍在等候。';
  await page.route('https://api.siliconflow.cn/**',async route=>{
    const payload=route.request().postDataJSON();calls++;
    expect(route.request().headers().authorization).toBe('Bearer chat-layout-fixture');
    const extracting=payload.messages.some((m:{content:string})=>m.content.includes('EXTRACTOR v1'));
    let text=prose;
    if(extracting){
      const packet=JSON.parse(payload.messages.at(-1).content),state=packet.state;
      expect(payload.messages[0].content).toContain('不包含主角player');
      text=JSON.stringify({sceneProposal:{minutes:0,location:state.location,present:[...state.present,invalid?'unknown-npc':'player'],weather:state.weather,evidence:{blockId:'b0',quote:prose.split('\n\n')[0]}},
        facts:[{kind:'confirmed_event',subject:'scene',content:prose.split('\n\n')[0],knownBy:['player'],revealed:true,importance:2,evidence:{blockId:'b0',quote:prose.split('\n\n')[0]}}],
        knowledgeProposals:[],relationshipEvidence:[],eventProposals:[],pendingThreads:[],suggestedActions:['问来人有什么事。','看看窗外。','再等待片刻。'],validationWarnings:[]});
    }
    await new Promise(resolve=>setTimeout(resolve,800));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{finish_reason:'stop',message:{content:text}}]})});
  });
  await page.goto('./');await page.getByRole('button',{name:'翻开新篇',exact:true}).click();
  await page.getByLabel('卷册名',{exact:true}).fill('简洁聊天 '+width);
  await page.getByRole('button',{name:'开始新故事',exact:true}).click();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:/硅基流动.*请手动选择/}).click();
  const settings=page.getByRole('dialog',{name:'编辑模型配置',exact:true});
  await settings.getByLabel('模型 ID',{exact:true}).fill('Qwen/Qwen3-8B');
  await settings.getByLabel('API Key',{exact:true}).fill('chat-layout-fixture');
  await settings.getByRole('button',{name:'用于游戏续写',exact:true}).click();
  await page.getByLabel('自由输入',{exact:true}).fill('先等片刻');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.draft-progress>p')).toBeVisible();
  await expect(page.locator('.draft-progress details')).not.toHaveAttribute('open');
  await expect(page.locator('.reader .story-turn')).toHaveCount(2,{timeout:30000});
  await expect(page.locator('.draft-card')).toHaveCount(0);expect(calls).toBe(2);
  const last=page.locator('.reader .story-turn').last();
  await expect(last.locator('.turn-tools>span')).toHaveText('已保存');
  await expect(last.getByText('siliconflow / Qwen/Qwen3-8B · 已保存',{exact:true})).not.toBeVisible();
  await last.locator('.turn-tools>details>summary').click();
  await expect(last.getByText('siliconflow / Qwen/Qwen3-8B · 已保存',{exact:true})).toBeVisible();
  await last.locator('.turn-tools>details>summary').click();
  invalid=true;await page.getByLabel('自由输入',{exact:true}).fill('继续等一会');await page.getByRole('button',{name:'发送',exact:true}).click();
  const draft=page.locator('.draft-card');await expect(draft.locator('.draft-label')).toContainText('尚未保存',{timeout:30000});
  await expect(page.locator('.reader .story-turn')).toHaveCount(2);expect(calls).toBe(4);
  await expect(draft.getByRole('button',{name:'保存这段剧情',exact:true})).toBeVisible();
  await expect(draft.locator('.recovery-more')).not.toHaveAttribute('open');
  await expect(draft.getByText(/人物 ID 不在当前分支/)).not.toBeVisible();
  await expect(draft.getByLabel('此次记忆整理模型')).not.toBeVisible();
  await expect(draft.getByRole('button',{name:'重写草稿',exact:true})).not.toBeVisible();
  await draft.scrollIntoViewIfNeeded();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await draft.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:'artifacts/chat-recovery-compact-'+width+'.png',fullPage:true});
  await draft.locator('.recovery-more>summary').click();
  await expect(draft.getByText(/人物 ID 不在当前分支/)).toBeVisible();
  await draft.getByText('调整重试模型与等待时间',{exact:true}).click();
  await expect(draft.getByLabel('此次记忆整理模型')).toBeVisible();
  await draft.getByLabel('此次整理等待 / 秒').fill('120');
  invalid=false;await draft.getByRole('button',{name:'重试整理并自动保存',exact:true}).click();
  await expect(page.locator('.reader .story-turn')).toHaveCount(3,{timeout:30000});await expect(draft).toHaveCount(0);
  expect(calls).toBe(5);await page.reload();await expect(page.locator('.reader .story-turn')).toHaveCount(3);
  await expect(page.locator('.reader .story-turn').last()).toContainText(prose.split('\n\n')[0]);
  expect(errors).toEqual([]);
});

test('eight recovery states have touch targets, focus and no horizontal scroll',async({page})=>{
  const preview=await readFile('src/components/DraftRecovery.preview.html','utf8'),css=await readFile('app/globals.css','utf8');
  for(const width of [320,375,414,768]){
    await page.setViewportSize({width,height:900});
    await page.setContent(preview.replace('<link rel="stylesheet" href="../../app/globals.css">','<style>'+css.replace(/@import "tailwindcss";/,'')+'</style>'));
    await expect(page.getByRole('heading',{level:2})).toHaveCount(8);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const button of await page.getByRole('button').all()){
      const box=await button.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await button.evaluate(el=>el.scrollHeight<=el.clientHeight)).toBe(true);
    }
    await expect(page.locator('.is-focus')).toHaveCSS('outline-style','solid');
    await page.screenshot({path:'artifacts/chat-recovery-states-'+width+'.png',fullPage:true});
  }
});
