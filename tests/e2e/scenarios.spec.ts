import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {importPackageZip} from '../../src/scenario/package';
async function create(page:Page,title:string,customStats=false){
 await page.goto('/');await page.getByRole('button',{name:'剧本库',exact:true}).click();await page.getByRole('button',{name:'创建新剧本',exact:true}).click();
 const form=page.getByRole('dialog',{name:'创建／整理剧本'});
 await form.getByLabel('剧本名称',{exact:true}).fill(title);await form.getByLabel('世界背景',{exact:true}).fill('现代城市的失窃案件。证词尚待核实。');
 await form.getByLabel('玩家角色姓名',{exact:true}).fill('林岚');await form.getByLabel('玩家人设',{exact:true}).fill('独立侦探，由玩家控制。');
 await form.getByLabel('初始 NPC',{exact:true}).fill('周宁｜证人｜店员，带来失物清单\n许舟｜调查员｜核查监控');
 await form.getByLabel('开场地点',{exact:true}).fill('侦探办公室');await form.getByLabel('周宁',{exact:true}).check();
 await form.getByLabel('开局原文',{exact:true}).fill('侦探办公室里，周宁将失物清单放在桌上。\n\n“可以帮忙查一下吗？”');
 await form.getByLabel('写作风格',{exact:true}).fill('现代推理小说。证据有来源，保留玩家回答空间。');
 await form.getByLabel('自定义世界状态',{exact:true}).fill('clues｜线索｜0｜100｜10\nrisk｜风险｜0｜10｜2\nresources｜资源｜0｜20｜12');
 if(customStats){await form.getByLabel('启用人物数值',{exact:true}).check();await form.getByLabel('自定义人物数值',{exact:true}).fill('respect｜尊重｜-10｜10｜3');}
 await form.getByLabel('时间系统',{exact:true}).selectOption(customStats?'relative':'gregorian');await form.getByRole('button',{name:'预览剧本',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'安装前预览'});await expect(preview).toContainText(customStats?'人物数值：尊重':'人物数值：关闭');await expect(preview).toContainText('恋爱：关闭');await expect(preview).toContainText('NPC 2');await preview.getByRole('button',{name:'确认安装',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);return page.locator('.scenario-card').filter({has:page.getByRole('heading',{name:title,exact:true})});
}
for(const width of [360,390,430,768,1440])test('scenario authoring and independent modern play fit width '+width,async({page})=>{
 await page.setViewportSize({width,height:900});const title='侦探 '+width;const card=await create(page,title);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await card.getByRole('button',{name:'开始新游戏',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'你的卷册'});await dialog.getByLabel('卷册名',{exact:true}).fill(title+' · 测试');await dialog.getByRole('button',{name:'开始新故事',exact:true}).click();await expect(dialog).toHaveCount(0);
 await expect(page.locator('.prose').first()).toContainText('侦探办公室');await expect(page.locator('.scene-label').first()).toContainText('林岚、周宁');await expect(page.locator('.app')).not.toContainText('玄天华');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const input=page.getByLabel('自由输入');await input.fill('请周宁说明清单。');await input.press('Enter');await input.pressSequentially('先不作结论。');await expect(page.locator('.story-turn')).toHaveCount(1);
 await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});await input.dispatchEvent('compositionend');await expect(page.locator('.story-turn')).toHaveCount(1);
 await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.locator('.story-turn')).toHaveCount(2);await expect(page.locator('.draft-card')).toHaveCount(0);
 await page.reload();await expect(page.locator('.story-turn')).toHaveCount(2);await page.getByRole('button',{name:'人物簿',exact:true}).click();await expect(page.getByRole('button',{name:/查看人物 周宁/})).toBeVisible();await expect(page.locator('.character-page')).not.toContainText('恋爱线');
 await page.screenshot({path:'artifacts/scenario-'+width+'-'+test.info().project.name+'.png',fullPage:true});
});
test('mobile custom character values, relative dates and UI-only grouping use the authored definitions',async({page})=>{
 await page.setViewportSize({width:390,height:844});const card=await create(page,'人物数值与分类',true);await card.getByRole('button',{name:'开始新游戏',exact:true}).click();await page.getByRole('dialog',{name:'你的卷册'}).getByRole('button',{name:'开始新故事',exact:true}).click();
 await expect(page.locator('.reading-toolbar')).toContainText('第1天');await page.getByRole('button',{name:'人物簿',exact:true}).click();await page.getByRole('button',{name:/查看人物 周宁/}).click();await expect(page.getByLabel('人物数值',{exact:true})).toContainText('尊重：3');await expect(page.locator('.character-detail')).not.toContainText('好感');
 await page.getByText('自定义人物分组',{exact:true}).click();await page.getByLabel('人物分类名称').fill('案件证人');await page.getByRole('button',{name:'保存分类',exact:true}).click();await expect(page.getByRole('status')).toContainText('分组已保存');await page.getByRole('button',{name:'返回人物簿',exact:true}).click();await page.getByLabel('人物分组').selectOption('custom:案件证人');await expect(page.locator('.character-list > button')).toHaveCount(1);await expect(page.locator('.character-list')).toContainText('周宁');
 await page.getByRole('button',{name:'故事',exact:true}).click();await expect(page.locator('.story-turn')).toHaveCount(1);await page.reload();await expect(page.locator('.story-turn')).toHaveCount(1);
});
test('mobile file chooser ZIP export/import previews identical templates without changing the save',async({page})=>{
 await page.setViewportSize({width:390,height:844});const title='可移植侦探';const card=await create(page,title);const event=page.waitForEvent('download');await card.getByRole('link',{name:'导出剧本 ZIP',exact:true}).click();const download=await event,path=await download.path();expect(path).toBeTruthy();const bytes=await readFile(path!);const p=importPackageZip(bytes);expect(p.characters).toHaveLength(2);expect(p.manifest.relationshipSystem.enabled).toBe(false);
 await page.getByLabel('导入剧本 ZIP',{exact:true}).setInputFiles({name:'detective.zip',mimeType:'application/zip',buffer:bytes});const preview=page.getByRole('dialog',{name:'安装前预览'});await expect(preview).toContainText(title);await preview.getByRole('button',{name:'确认安装',exact:true}).click();await expect(page.locator('.scenario-card').filter({has:page.getByRole('heading',{name:title,exact:true})})).toHaveCount(1);
 await page.getByRole('button',{name:'复制剧本',exact:true}).first().click();const form=page.getByRole('dialog',{name:'创建／整理剧本'});await form.getByLabel('剧本名称',{exact:true}).fill('大曜测试副本');await form.getByRole('button',{name:'预览剧本',exact:true}).click();const copy=page.getByRole('dialog',{name:'安装前预览'});await expect(copy).toContainText('NPC 6');await expect(copy).toContainText('人物数值：信任、好感');await expect(copy).toContainText('恋爱：允许');
});
test('mobile TXT file import keeps rules, original text and unknown facts until preview is confirmed',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'剧本库',exact:true}).click();const before=await page.locator('.scenario-card').count(),raw='世界\n现代城市\n玩家\n林岚｜侦探\n人物\n周宁｜证人｜等待询问\n规则\n没有证据时不宣布结案。\n开局\n电话响起。\n文风\n清晰的现代小说。';await page.getByLabel('导入背景 TXT／MD',{exact:true}).setInputFiles({name:'设定.txt',mimeType:'text/plain',buffer:Buffer.from(raw)});
 const form=page.getByRole('dialog',{name:'创建／整理剧本'});await expect(form.getByLabel('原始背景文本')).toHaveValue(raw);await form.getByRole('button',{name:'按标题直接整理',exact:true}).click();await expect(form.getByLabel('剧情与关系规则')).toHaveValue('没有证据时不宣布结案。');await expect(form.getByLabel('写作风格')).toHaveValue('清晰的现代小说。');await expect(page.locator('.scenario-card')).toHaveCount(before);await form.getByLabel('剧本名称',{exact:true}).fill('导入的原创世界');await form.getByRole('button',{name:'预览剧本',exact:true}).click();
 const preview=page.getByRole('dialog',{name:'安装前预览'});await expect(preview).toContainText('没有证据时不宣布结案。');await expect(page.locator('.scenario-card')).toHaveCount(before);await preview.getByRole('button',{name:'确认安装',exact:true}).click();await expect(page.locator('.scenario-card')).toHaveCount(before+1);
});
