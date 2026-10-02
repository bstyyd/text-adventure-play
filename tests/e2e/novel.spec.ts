import { test,expect } from '@playwright/test';
test.beforeEach(async({page})=>{
  // Embedded browsers can reject native dialogs; every UI flow must work without them.
  await page.addInitScript(()=>{
    window.prompt=()=>{throw new Error('prompt() is not supported.');};
    window.confirm=()=>{throw new Error('confirm() is not supported.');};
  });
});
async function newGame(page:import('@playwright/test').Page,title='验收卷册'){
  await page.goto('/');await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.getByLabel('卷册名').fill(title);await page.getByRole('button',{name:'开始新故事'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.prose').first()).toContainText('门外传来脚步声');
}
async function send(page:import('@playwright/test').Page,text:string){
  await page.getByLabel('自由输入').fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.story-turn .player-line').last()).toContainText(text);
  await expect(page.getByRole('button',{name:'停止生成'})).toHaveCount(0);
}
test('action suggestions use current prose and only fill the free input',async({page})=>{
  await newGame(page,'当前情节建议');await send(page,'让沈彻进来');await send(page,'请解释账目差额。');
  await page.getByRole('button',{name:'关闭提示',exact:true}).click();
  await page.setViewportSize({width:584,height:698});await page.getByRole('button',{name:'收起卷册',exact:true}).click();
  let generations=0,suggestions=0;
  page.on('request',r=>{if(r.method()==='POST'){if(r.url().endsWith('/turns'))generations++;if(r.url().endsWith('/suggestions'))suggestions++;}});
  await page.locator('.suggestions summary').click();expect(suggestions).toBe(0);
  await page.getByRole('button',{name:'生成本段建议',exact:true}).click();
  const choices=page.locator('.suggestion-options button');
  await expect(choices).toHaveCount(3);await expect(choices.first()).toContainText('沈彻');
  await expect(choices.first()).toContainText('账目');expect(suggestions).toBe(1);expect(generations).toBe(0);
  await expect(page.locator('.suggestion-panel')).toBeInViewport();
  await page.screenshot({path:'artifacts/context-suggestions.png',fullPage:true});
  const chosen=await choices.first().innerText();await choices.first().click();
  await expect(page.getByLabel('自由输入')).toHaveValue(chosen);await expect(page.getByLabel('自由输入')).toBeFocused();
  await expect(page.locator('.story-turn')).toHaveCount(3);expect(generations).toBe(0);
  await send(page,'睡到明日');
  await page.locator('.suggestions summary').click();await expect(page.locator('.suggestion-options button')).toHaveCount(0);
  await page.getByRole('button',{name:'生成本段建议',exact:true}).click();
  await expect(page.locator('.suggestion-options button')).toHaveCount(3);expect(suggestions).toBe(2);
});
test('action suggestion failure offers retry and never sends a player turn',async({page})=>{
  await newGame(page,'建议失败恢复');let attempts=0;
  await page.route('**/api/suggestions',async route=>{
    attempts++;if(attempts===1){await route.fulfill({status:502,json:{error:'建议请求超时测试'}});return;}
    await route.continue();
  });
  await page.locator('.suggestions summary').click();await page.getByRole('button',{name:'生成本段建议',exact:true}).click();
  await expect(page.locator('.suggestion-panel')).toContainText('建议请求超时测试');
  await expect(page.locator('.story-turn')).toHaveCount(1);
  await page.getByRole('button',{name:'生成本段建议',exact:true}).click();
  await expect(page.locator('.suggestion-options button')).toHaveCount(3);expect(attempts).toBe(2);
  await page.reload();await expect(page.locator('.story-turn')).toHaveCount(1);
});
for(const scenario of [
  {name:'complete',bodyComplete:true,bodyFinishReason:'stop',failureStage:'extraction',message:'记忆整理失败，正文已完整接收',expected:'正文已完整接收'},
  {name:'truncated',bodyComplete:false,bodyFinishReason:'length',failureStage:'generation',message:'正文生成未完成：输出达到 token 上限',expected:'正文未完成'},
  {name:'legacy',bodyComplete:undefined,bodyFinishReason:undefined,failureStage:undefined,message:'旧版本连接失败或连接超时',expected:'旧草稿未记录结束状态'},
])test('draft completion display and safe recovery: '+scenario.name,async({page})=>{
  await newGame(page,'正文状态 '+scenario.name);await page.setViewportSize({width:584,height:958});
  await page.getByRole('button',{name:'收起卷册',exact:true}).click();
  await page.route('**/api/drafts/*',async route=>{
    if(route.request().method()!=='GET'){await route.continue();return;}
    const response=await route.fetch(),draft=await response.json();
    await route.fulfill({json:{...draft,status:'failed',bodyComplete:scenario.bodyComplete,bodyFinishReason:scenario.bodyFinishReason,failureStage:scenario.failureStage,error:scenario.message}});
  });
  await page.getByLabel('自由输入').fill('让沈彻进来');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.locator('.draft-progress')).toContainText(scenario.expected);
  await expect(page.locator('.draft-progress')).toContainText('字符');
  const retry=page.getByRole('button',{name:'重试整理并自动保存',exact:true});
  if(scenario.bodyComplete)await expect(retry).toBeEnabled();else await expect(retry).toBeDisabled();
  await page.locator('.draft-card .error-text').scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/draft-'+scenario.name+'.png',fullPage:true});
  if(scenario.name==='legacy'){
    await page.getByRole('button',{name:'核对／修订正文',exact:true}).click();
    await expect(page.getByLabel('核对草稿正文')).not.toHaveValue('');
    await expect(page.getByRole('button',{name:'保存修改并自动整理'})).toBeVisible();
  }
});
test('embedded browser deletes only the named save after explicit confirmation',async({page})=>{
  let deletionRequests=0;
  page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/delete'))deletionRequests++;});
  await newGame(page,'删除验收 · 保留');await send(page,'让沈彻进来');
  await newGame(page,'删除验收 · 待删');
  await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.setViewportSize({width:717,height:956});
  const row=page.locator('.save-list>div').filter({hasText:'删除验收 · 待删'});
  await row.getByRole('button',{name:'删除',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'删除卷册',exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'备份并删除'})).toBeDisabled();
  await page.screenshot({path:'artifacts/delete-confirmation.png',fullPage:true});
  await dialog.getByLabel('完整卷册名').fill('名称不匹配');
  await expect(dialog.getByRole('button',{name:'备份并删除'})).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);await expect(page.getByRole('dialog',{name:'你的卷册'})).toBeVisible();
  expect(deletionRequests).toBe(0);
  await expect(row.getByRole('button',{name:'删除',exact:true})).toBeFocused();
  await page.route('**/api/saves/*/delete',route=>route.fulfill({status:500,json:{error:'备份失败测试：未删除卷册'}}));
  await row.getByRole('button',{name:'删除',exact:true}).click();
  await dialog.getByLabel('完整卷册名').fill('删除验收 · 待删');
  await dialog.getByRole('button',{name:'备份并删除'}).click();
  await expect(page.getByRole('alert').filter({hasText:'备份失败测试'})).toContainText('未删除卷册');await expect(row).toBeVisible();
  expect(deletionRequests).toBe(1);
  await page.unroute('**/api/saves/*/delete');
  await row.getByRole('button',{name:'删除',exact:true}).click();
  await dialog.getByLabel('完整卷册名').fill('删除验收 · 待删');
  await dialog.getByRole('button',{name:'备份并删除'}).click();
  await expect(row).toHaveCount(0);expect(deletionRequests).toBe(2);
  await expect(page.locator('.save-list>div').filter({hasText:'删除验收 · 保留'})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'存档',exact:true}).click();
  await expect(row).toHaveCount(0);
});
test('embedded browser edits input on a new branch while retaining the original future',async({page})=>{
  await newGame(page,'重写验收');await send(page,'让沈彻进来');await send(page,'旧分支独有的青铜鹤');
  await page.setViewportSize({width:717,height:956});
  await page.getByRole('button',{name:'收起卷册',exact:true}).click();
  let forks=0,generations=0;
  page.on('request',r=>{if(r.method()==='POST'){if(r.url().endsWith('/fork'))forks++;if(r.url().endsWith('/turns'))generations++;}});
  const turn=page.locator('.story-turn').nth(1);
  await turn.locator('.turn-tools summary').click();
  await turn.getByRole('button',{name:'编辑输入 / 重写此节',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'修改这一节',exact:true});
  await expect(dialog).toBeVisible();await page.screenshot({path:'artifacts/rewrite-input.png',fullPage:true});
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.locator('.story-turn')).toHaveCount(3);
  expect(forks).toBe(0);
  await turn.getByRole('button',{name:'编辑输入 / 重写此节',exact:true}).click();
  await expect(dialog.getByLabel('修订玩家输入')).toHaveValue('让沈彻进来');
  await dialog.getByLabel('修订玩家输入').fill('先问门外是何人。');
  expect(forks).toBe(0);expect(generations).toBe(0);
  await dialog.getByRole('button',{name:'重新生成并保存',exact:true}).click();
  await expect(dialog).toHaveCount(0);await expect(page.locator('.story-turn')).toHaveCount(2);
  expect(forks).toBe(1);expect(generations).toBe(1);
  await expect(page.locator('.story-turn').last()).toContainText('先问门外是何人。');
  await expect(page.locator('.reader')).not.toContainText('青铜鹤');
  await page.getByRole('button',{name:'往事',exact:true}).click();
  await page.getByText('回看分支').locator('select').selectOption({label:'正篇'});
  await expect(page.locator('.history-card')).toHaveCount(3);
  await expect(page.locator('.history-card').last()).toContainText('旧分支独有的青铜鹤');
  await page.getByRole('button',{name:'故事',exact:true}).click();
  await expect(page.locator('.story-turn')).toHaveCount(2);
  await page.reload();await expect(page.locator('.story-turn')).toHaveCount(2);
});
test('mobile autosaves without confirmation and edits saved prose in one submit, retaining the old future',async({page})=>{
  await page.setViewportSize({width:360,height:800});
  await newGame(page,'自动保存与正文修改');
  let forks=0,revisions=0,manualReviews=0;
  page.on('request',r=>{if(r.method()==='POST'){
    if(r.url().endsWith('/fork'))forks++;
    if(r.url().endsWith('/turns/revise'))revisions++;
    if(/\/drafts\/[^/]+\/review$/.test(r.url()))manualReviews++;
  }});
  await send(page,'让沈彻进来');await send(page,'旧未来中的白玉棋盘');
  await expect(page.locator('.story-turn')).toHaveCount(3);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.draft-card')).toHaveCount(0);
  const original=await page.locator('.story-turn').nth(1).locator('.prose p').allTextContents();
  await page.getByRole('button',{name:'修改第1节',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'修改这一节'});
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(dialog.getByLabel('修订玩家输入')).toHaveValue('让沈彻进来');
  const revised='殿门推开，沈彻走进御书房，在案前三步处站定。\n\n沈彻拱手道：“北边的粮道有阻，尚需查证。”';
  await dialog.getByLabel('修订正式正文').fill(revised);
  await dialog.getByRole('button',{name:'保存修改',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'artifacts/saved-story-edit-mobile.png',fullPage:true});
  expect(forks).toBe(0);expect(revisions).toBe(0);
  await dialog.getByRole('button',{name:'保存修改',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.story-turn')).toHaveCount(2);
  await expect(page.locator('.story-turn').last()).toContainText('北边的粮道有阻');
  await expect(page.locator('.draft-card')).toHaveCount(0);
  expect(forks).toBe(1);expect(revisions).toBe(1);expect(manualReviews).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await expect(page.locator('.story-turn').last()).toContainText('北边的粮道有阻');
  await page.getByRole('button',{name:'往事',exact:true}).click();
  await page.getByText('回看分支').locator('select').selectOption({label:'正篇'});
  await expect(page.locator('.history-card')).toHaveCount(3);
  await expect(page.locator('.history-card').nth(1).locator('.prose p')).toHaveText(original);
  await expect(page.locator('.history-card').last()).toContainText('旧未来中的白玉棋盘');
  await page.getByRole('button',{name:'故事',exact:true}).click();
  await expect(page.locator('.story-turn')).toHaveCount(2);
  await expect(page.locator('.reader')).not.toContainText('旧未来中的白玉棋盘');
});

test('embedded text dialogs also support renaming, bookmarks, notes and composition',async({page})=>{
  await newGame(page,'弹窗文字验收');await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.locator('.save-list>div').filter({hasText:'弹窗文字验收'}).getByRole('button',{name:'改名',exact:true}).click();
  const rename=page.getByRole('dialog',{name:'重命名卷册',exact:true});
  const name=rename.getByLabel('卷册名称');await name.fill('书斋新卷');
  await name.dispatchEvent('compositionstart');await page.keyboard.press('Enter');
  await expect(rename).toBeVisible();await name.dispatchEvent('compositionend');
  await page.keyboard.press('Enter');await expect(rename).toHaveCount(0);
  await expect(page.locator('.save-list')).toContainText('书斋新卷');
  await page.getByRole('dialog',{name:'你的卷册'}).getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'书签第0节',exact:true}).click();
  const bookmark=page.getByRole('dialog',{name:'书签与非正史笔记'});
  await bookmark.getByLabel('书签笔记').fill('先记一笔\n明日再看');
  await bookmark.getByRole('button',{name:'保存书签'}).click();
  await expect(page.locator('.bookmark-row')).toContainText(['先记一笔']);
  await page.getByRole('button',{name:'记忆',exact:true}).click();
  await page.locator('.memory-card').first().getByRole('button',{name:'笔记',exact:true}).click();
  const note=page.getByRole('dialog',{name:'记忆笔记'});
  await note.getByLabel('笔记内容').fill('这只是私人笔记，尚未查证。');
  await note.getByRole('button',{name:'保存标注'}).click();
  await expect(page.locator('.memory-card').first()).toContainText('这只是私人笔记，尚未查证。');
});
test('embedded model confirmation requires a choice before the mocked request',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:/Google AI · Gemma.*gemma-4/}).click();
  let calls=0;
  await page.route('**/api/providers/models',async route=>{
    calls++;expect(route.request().postDataJSON().authorizeNetwork).toBe(true);
    await route.fulfill({json:{models:[{id:'gemma-4-26b-a4b-it'}]}});
  });
  await page.getByRole('button',{name:'获取模型列表',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'确认模型请求'});
  await expect(confirm).toBeVisible();expect(calls).toBe(0);
  await confirm.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'编辑模型配置'})).toBeVisible();expect(calls).toBe(0);
  await page.getByRole('button',{name:'获取模型列表',exact:true}).click();
  await confirm.getByRole('button',{name:'确认发送',exact:true}).click();
  await expect(page.locator('#model-ids option')).toHaveAttribute('value','gemma-4-26b-a4b-it');
  expect(calls).toBe(1);
  await page.route('**/api/providers/test',route=>route.fulfill({json:{message:'模拟连接成功'}}));
  await page.getByRole('button',{name:'测试连接',exact:true}).click();
  await confirm.getByRole('button',{name:'确认发送',exact:true}).click();
  const result=page.getByRole('dialog',{name:'记忆与来源预览'});
  await expect(result).toContainText('模拟连接成功');
  await result.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'编辑模型配置'})).toBeVisible();
});
test('卷册名 can delete Chinese characters continuously and edit in place',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'存档',exact:true}).click();
  await page.setViewportSize({width:686,height:956});
  const title=page.getByLabel('卷册名');
  await title.fill('灯下山河');
  await title.click();await page.keyboard.press('End');
  // Use the keyboard directly: locator.press() would refocus and hide this regression.
  for(const value of ['灯下山','灯下','灯','']){
    await page.keyboard.press('Backspace');
    await expect(title).toHaveValue(value);await expect(title).toBeFocused();
  }
  await page.keyboard.insertText('山河新章');await expect(title).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText('故纸新篇');
  await expect(title).toHaveValue('故纸新篇');await expect(title).toBeFocused();
  await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Delete');await expect(title).toHaveValue('故纸篇');
  await page.keyboard.press('Backspace');await expect(title).toHaveValue('故篇');
  await expect(title).toBeFocused();
});
test('卷册名 composition keeps focus and Escape dismisses only after composition',async({page})=>{
  await page.goto('/');const opener=page.getByRole('button',{name:'存档',exact:true});await opener.click();
  const title=page.getByLabel('卷册名');await title.click();await page.keyboard.press('ControlOrMeta+A');
  await title.dispatchEvent('compositionstart');await page.keyboard.insertText('春山');
  await expect(title).toHaveValue('春山');await expect(title).toBeFocused();
  await title.dispatchEvent('keydown',{key:'Escape',code:'Escape',isComposing:true});
  await expect(page.getByRole('dialog',{name:'你的卷册'})).toBeVisible();await expect(title).toBeFocused();
  await title.dispatchEvent('keydown',{key:'Escape',code:'Escape',keyCode:229});
  await expect(page.getByRole('dialog',{name:'你的卷册'})).toBeVisible();
  await title.dispatchEvent('compositionend',{data:'春山'});
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
});
test('A01 B04 H11 prologue, free input, memories and reload persist',async({page})=>{
  await newGame(page);await expect(page.locator('.scene-label').first()).toContainText('玄天华一人');
  await expect(page.locator('.suggestions')).not.toHaveAttribute('open','');
  await send(page,'让沈彻进来');await send(page,'明日再查，不必今夜给出结论。');
  await page.reload();await expect(page.locator('.story-turn')).toHaveCount(3);
  await page.getByRole('button',{name:'记忆',exact:true}).click();await expect(page.locator('.memory-card')).toContainText(['17%','让沈彻进来','明日再查']);
  await page.getByRole('button',{name:'原文来源',exact:false}).last().click();await expect(page.locator('.reader')).toBeVisible();
});
test('B05 IME composition enter never sends; multiline input works',async({page})=>{
  await newGame(page,'输入法');const input=page.getByLabel('自由输入');await input.fill('拼音选词');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');await expect(page.locator('.story-turn')).toHaveCount(1);
  await input.dispatchEvent('compositionend');await input.fill('第一行\n第二行');await input.press('Shift+Enter');await expect(page.locator('.story-turn')).toHaveCount(1);
  await input.fill('让沈彻进来');await input.press('Enter');await expect(page.locator('.story-turn')).toHaveCount(1);await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.story-turn')).toHaveCount(2);
});
test('B07 OOC is separate; B03 remote NPC contact does not teleport',async({page})=>{
  await newGame(page,'OOC验收');await page.getByLabel('自由输入').fill('OOC：少用解释性的旁白');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('OOC 已单独保存');await expect(page.locator('.story-turn')).toHaveCount(1);
  await page.getByRole('button',{name:'人物与朝局',exact:true}).click();await page.getByRole('button',{name:/拓跋野.*北狄可汗/}).click();
  await expect(page.getByRole('dialog')).toContainText('草原的盟友');await expect(page.getByRole('dialog')).toContainText('此人当前不在场');await expect(page.getByRole('dialog').getByRole('button',{name:'召见',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'书信',exact:true}).click();
  await expect(page.getByLabel('自由输入')).toHaveValue('写信给拓跋野：');await expect(page.locator('.story-turn')).toHaveCount(1);
  await page.getByRole('button',{name:'记忆',exact:true}).click();await expect(page.locator('.ooc-list')).toContainText('少用解释性的旁白');
});
test('D01–D08 date search, old snapshot and branch exclude future',async({page})=>{
  await newGame(page,'日期与分支');await send(page,'让沈彻进来');await send(page,'此支独有秘密玉笛');await send(page,'睡到明日');
  await page.getByRole('button',{name:'往事',exact:true}).click();await page.getByLabel('游戏日期止').fill('1-3-29');await page.getByText('截止边界').locator('select').selectOption('false');
  await expect(page.locator('.history-card')).toHaveCount(3);
  await page.getByText('截止边界').locator('select').selectOption('true');await expect(page.locator('.history-card')).toHaveCount(4);
  await page.getByLabel('搜索原文').fill('沈彻');expect(await page.locator('.history-card').count()).toBeGreaterThan(0);
  await page.getByLabel('搜索原文').fill('');await page.getByRole('button',{name:'查看当时状态',exact:true}).first().click();
  await expect(page.getByRole('dialog')).toContainText('消息 0');await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'从此处另开分支',exact:true}).nth(1).click();
  const forkDialog=page.getByRole('dialog',{name:'另开分支',exact:true});
  await forkDialog.getByLabel('新分支名称').fill('新命运');await forkDialog.getByRole('button',{name:'创建分支'}).click();
  await expect(page.locator('.story-turn')).toHaveCount(2);await expect(page.locator('.reader')).not.toContainText('玉笛');
  await page.getByRole('button',{name:'往事',exact:true}).click();await page.getByText('回看分支').locator('select').selectOption({label:'正篇'});
  await expect(page.locator('.history-card')).toHaveCount(4);
  await page.getByRole('button',{name:'故事',exact:true}).click();await expect(page.locator('.story-turn')).toHaveCount(2);
  await page.reload();await expect(page.locator('.story-turn')).toHaveCount(2);
});
test('G01 failed extraction recovery UI keeps uncommitted draft',async({page})=>{
  await newGame(page,'错误恢复');
  // Exercise UI with a server-side failed draft fixture, then real retry endpoint.
  let injected=false;
  await page.route('**/api/drafts/*',async route=>{
    if(route.request().method()==='GET'&&!injected){
      injected=true;const res=await route.fetch(),d=await res.json();
      await route.fulfill({json:{...d,status:'failed',error:'测试：记忆整理失败，尚未提交。'}});return;
    }
    await route.continue();
  });
  await page.getByLabel('自由输入').fill('让沈彻进来');await page.getByRole('button',{name:'发送',exact:true}).click();
  await expect(page.getByRole('button',{name:'重试整理并自动保存'})).toBeVisible();
  await page.getByRole('button',{name:'重试整理并自动保存'}).click();await expect(page.locator('.story-turn')).toHaveCount(2);
});
test('H08 text output never executes HTML; no keys in browser storage',async({page})=>{
  await newGame(page,'文本安全');await send(page,'<script>window.__storyAttack=1</script> 我说这是文字。');
  expect(await page.evaluate(()=>Object.hasOwn(window,'__storyAttack'))).toBe(false);
  const state=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage}}));expect(JSON.stringify(state)).not.toMatch(/api.?key|secret/i);
});
test('responsive reading and screenshots on desktop/mobile',async({page})=>{
  await newGame(page,'灯下山河');
  await page.screenshot({path:'artifacts/desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'收起卷册',exact:true}).click();
  await expect(page.getByLabel('自由输入')).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/mobile.png',fullPage:true});
});
test('H09 cross-site requests rejected',async({request})=>{
  const r=await request.post('/api/saves',{headers:{Origin:'https://evil.example'},data:{title:'forbidden'}});expect(r.status()).toBe(403);
});
test('B06 reading old paragraphs is not moved by a newly committed reply',async({page})=>{
  await newGame(page,'阅读位置');await send(page,'让沈彻进来');
  await page.locator('.reader').evaluate(e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll'));});
  await send(page,'今夜暂且闲聊。');
  expect(await page.locator('.reader').evaluate(e=>e.scrollTop)).toBeLessThan(50);
});
test('H02 key form clears on save; H04 JSON export imports a new save',async({page})=>{
  await newGame(page,'恢复验收');await send(page,'让沈彻进来');
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:/Google AI · Gemma.*gemma-4/}).click();
  await page.getByLabel('API Key',{exact:true}).fill('browser-test-key-never-call-upstream');await page.getByRole('button',{name:'保存配置与密钥'}).click();
  await expect(page.getByLabel('API Key',{exact:true})).toHaveValue('');
  const browserRecords=await page.evaluate(async()=>new Promise<unknown[]>((resolve,reject)=>{const r=indexedDB.open('dayao-browser-v1');r.onsuccess=()=>{const read=r.result.transaction('records').objectStore('records').getAll();read.onsuccess=()=>{resolve(read.result);r.result.close();};read.onerror=()=>reject(read.error);};r.onerror=()=>reject(r.error);}));
  expect(JSON.stringify(browserRecords)).not.toContain('browser-test-key-never-call-upstream');
  const publicCache=await page.evaluate(async()=>{const names=await caches.keys();const values:string[]=[];for(const name of names){const cache=await caches.open(name);for(const req of await cache.keys()){if(/\.(png|woff2?)$/.test(new URL(req.url).pathname))continue;values.push(await(await cache.match(req))!.text());}}return values.join('\n');});
  expect(publicCache).not.toContain('browser-test-key-never-call-upstream');
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('button',{name:'存档',exact:true}).click();
  const dl=page.waitForEvent('download');await page.getByRole('button',{name:'可恢复 JSON',exact:true}).click();const archive=await dl,filepath=await archive.path();
  expect(filepath).toBeTruthy();await page.locator('input[type=file][accept=".json"]').setInputFiles(filepath!);
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.story-turn')).toHaveCount(2);await expect(page.locator('.save-title')).toContainText('导入');
});
