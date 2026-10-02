import {createScenarioDraft} from '../../src/scenario/draft';
import {validateScenario} from '../../src/scenario/package';
// Only imported by tests. Never installed by application startup.
export function detectiveScenario(){
  const p=createScenarioDraft({title:'雨夜失窃案',world:'2026 年的现代城市。侦探办公室收到一宗失窃案，证词和监控尚待核实。',playerName:'林岚',playerDescription:'独立侦探，由玩家决定询问、行动和推理。',npcs:'周宁｜证人｜邻近店铺的店员\n许舟｜调查员｜正在核查监控',opening:'办公室的电话响起。周宁坐在对面，将一份物品清单放在桌上。',style:'现代推理小说。以证据和人物对白推进，不替玩家得出结论。',calendarType:'gregorian',worldStats:'clues｜线索进度｜0｜100｜10\nrisk｜风险｜0｜10｜2\nresources｜资源｜0｜20｜12'},'test_detective');
  p.calendar.start={year:2026,month:10,day:2,minuteOfDay:540};
  p.locations=[{id:'office',name:'侦探办公室',parentId:null,description:'现代办公地点'},{id:'station',name:'警务站',parentId:null,description:''}];
  p.initialScene={locationId:'office',weather:'雨',present:['character_001'],pendingThreads:['失窃案尚待核实'],accessionOffsetDays:0};
  p.characters[0].initialLocation='office';p.characters[0].age=25;p.characters[0].aliases=['店员小周'];p.characters[0].immutableProfile=false;
  p.characters[1].initialLocation='station';p.characters[1].age=32;p.characters[1].privateBackground='许舟秘密哨兵：未告知玩家的线索。';
  p.rules.storyThreadTypes=['investigation','promise','custom'];
  p.ui.worldStatsTitle='案件状态';p.lore=[{id:'camera',title:'监控说明',content:'入口摄像头在案发时停机，原因未明。',tags:['监控'],characters:[],locations:[],factions:[],priority:8,visibility:'public'}, {id:'distant',title:'无关地点',content:'无关资料哨兵',tags:['海岸'],characters:[],locations:['station'],factions:[],priority:1,visibility:'public'}];
  p.references=[{id:'style_sample',purpose:'style_reference',content:'参考哨兵：已经破案，凶手落网。'}];
  return validateScenario(p);
}
