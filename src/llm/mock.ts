import { BaseProvider } from './types';
import type { TextRequest,TextResult,ModelList } from './types';
import type { Extraction, State } from '../domain/types';
import { blocks } from '../memory/context';
import { storyBodyIssues } from '../domain/story-body';
type MockCharacter={id:string;name:string;aliases?:string[]};
type MockPacket={calendar?:{type:string};player?:{name:string};playerText:string;body:string;state:State;characters?:MockCharacter[];characterIndex?:MockCharacter[]};
const visitor=(text:string)=>/请(军需吏|书吏|证人|使者|校尉|侍卫)([\u4e00-\u9fff]{2,4})进来/.exec(text);
const knownPeople=(items:MockCharacter[])=>[...new Map(items.map(c=>[c.id,c])).values()];
export class MockProvider extends BaseProvider{
  id='mock' as const;
  async listModels():Promise<ModelList>{return {status:'supported',models:[{id:'mock-novel-v1'}]};}
  async generateText(r:TextRequest):Promise<TextResult>{
    r.signal.throwIfAborted();await r.onAttempt?.();
    const input=r.messages.at(-1)?.content||'';
    let text='';
    if(r.system.startsWith('BODY_REPAIR')){
      // A deterministic recovery fixture, not a substitute for model prose editing.
      const packet=JSON.parse(input) as {playerText:string;originalDraft:string};
      text=packet.originalDraft.split(/\n\s*\n/).filter(p=>!storyBodyIssues(packet.playerText,p).length).join('\n\n');
    }else if(r.system.startsWith('SUGGESTIONS')){
      const packet=JSON.parse(input) as {characters:MockCharacter[];scene:{present:string[]};recent:{body:string}[];draft:{body:string}|null};
      const latest=packet.draft?.body||packet.recent.at(-1)?.body||'';
      const named=packet.characters.find(n=>latest.includes(n.name)&&(packet.draft||packet.scene.present.includes(n.id)));
      const topic=latest.includes('账')?'账目差额':latest.includes('信')?'来信的内容':latest.includes('折子')?'这份折子':'刚才提到的事情';
      text=JSON.stringify({actions:[named?'继续问'+named.name+'关于'+topic+'的细节。':'隔着门询问来人的身份与来意。','先核对'+topic+'，暂不下结论。',named?'请'+named.name+'稍候，留一点时间考虑。':'让门外的人稍候，先看清案上的材料。']});
    }else if(r.system.startsWith('EXTRACTOR')){
      const packet=JSON.parse(input) as MockPacket;
      text=JSON.stringify(this.extract(packet));
    }else if(r.system.startsWith('OOC')){
      text='已记为独立的出戏讨论：“'+input+'”。这一条不会改变人物认知、时间或剧情。若要修改已发生的情节，请在原文处另开分支；文风偏好可在设置中调整。';
    }else if(r.system.includes('连接正常'))text='连接正常（本地 Mock，无网络请求）。';
    else{
      let state:State|undefined,target:string|undefined;
      let people:MockCharacter[]=[];
      let facts:{content:string}[]=[];
      try{const ctx=JSON.parse(r.system);state=ctx.layer4?.state;target=ctx.layer4?.target;facts=ctx.layer3?.facts||[];people=knownPeople(ctx.layer3?.characterIndex||[]);}catch{}
      const matches=people.filter(n=>input.includes(n.name)),named=matches.length===1?matches[0]:undefined;
      const active=people.find(n=>n.id===target&&state?.present.includes(n.id))||people.find(n=>state?.present.includes(n.id));
      const newcomer=visitor(input);
      const location=state?.location||'当前场景';
      if(newcomer&&!people.some(c=>c.name===newcomer[2])){
        text=newcomer[1]+newcomer[2]+'走进'+location+'，在门内站定。\n\n“请容我将经手的事项说明。”来人等候询问。';
      }else if(named&&!state?.present.includes(named.id)&&/召|进来|请.{0,8}来|来见/.test(input)){
        text=named.name+'走进'+location+'，停在几步之外。\n\n“有什么需要说明的？”'+named.name+'等着下文，没有擅自替人作答。';
      }else if(named&&!state?.present.includes(named.id)){
        text=named.name+'尚不在当前场景。现有材料仍留在原处，如何联络还需要明确安排。';
      }else if(active){
        const topic=input.replace(/[“”"'<>]/g,'').slice(0,65);
        const memory=/记得|之前|答应|承诺|上次/.test(input)?facts.find(f=>/承诺|明日|再查|打算/.test(f.content))?.content:undefined;
        text=active.name+'听完，停了片刻。\n\n“'+(memory?'先前提过的事还在：'+memory:topic+'——我听见了。眼下这一处，还需要说明什么？')+'”\n\n材料中的账目或说法仍须核实。回应停在这里，等候下一句。';
      }else{
        text=location+'里一时安静。\n\n现场可见的材料和未决事项仍在，尚无新的核实结果。接下来如何询问、观察或等待，仍由玩家决定。';
      }
    }
    return {text,finishReason:'stop',usage:{input:0,output:0},requestId:null,requestCount:1};
  }
  extract(packet:MockPacket):Extraction{
    const {playerText,body,state}=packet,b=blocks(body),e={blockId:'player',quote:playerText};
    const people=knownPeople([...(packet.characters||[]),...(packet.characterIndex||[])]);
    const mentioned=people.find(n=>playerText.includes(n.name));
    const enter=mentioned&&/召|进来|请.{0,8}来|来见/.test(playerText)&&true;
    let present=enter?[...new Set([...state.present,mentioned.id])]:state.present;
    const newcomer=visitor(playerText);
    const creations:NonNullable<Extraction['proposedCharacterCreations']>=[];
    if(newcomer&&!people.some(c=>c.name===newcomer[2])&&body.includes(newcomer[2])){
      present=[...present,'new:visitor'];
      creations.push({draftRef:'new:visitor',name:newcomer[2],referenceName:newcomer[2],identity:newcomer[1],identityStatus:'confirmed',
        roleInStory:'前来说明经手事项',motivation:null,relevance:'supporting',presence:'present',location:state.location,
        evidence:{blockId:'b0',quote:body.split(/\n\s*\n/)[0]},knownBy:present,revealed:true});
    }
    const type=/明日|打算|准备|计划/.test(playerText)?'intent':/答应|承诺/.test(playerText)?'promise':/令|命令|去查|复核/.test(playerText)?'order':'claim';
    const minutes=packet.calendar?.type==='none'?0:/等到天亮|睡到明日/.test(playerText)?(1440-state.date.minuteOfDay+360):Math.min(2,1439-state.date.minuteOfDay);
    return {sceneProposal:{minutes,location:state.location,present,weather:state.weather,evidence:e},
      facts:[{kind:type,content:playerText,subject:packet.player?.name||'player',evidence:e,knownBy:/心想|心里|内心|心理/.test(playerText)?[]:present,revealed:true,importance:/明日|承诺|秘密/.test(playerText)?4:2}],
      knowledgeProposals:[],relationshipEvidence:[],eventProposals:[],pendingThreads:[],...(creations.length?{proposedCharacterCreations:creations}:{}),
      suggestedActions:['继续观察，等对方把话说完。','问清眼下尚未核实的事。','说说别的，暂不作决定。'],validationWarnings:Object.keys(b).length?[]:['缺少正文']};
  }
}
