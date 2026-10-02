export type StoryBodyIssue={start:number;end:number;quote:string;reason:string};

// Shared by the editor and server: these are bounded heuristics, not an NLP verdict.
export function storyBodyIssues(input:string,body:string,player:{name:string;aliases?:string[]}={name:'玩家角色'}):StoryBodyIssue[]{
  const names=[player.name,...(player.aliases||[]),'她','他','你'].map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\  const checks=[')).join('|');
  const re=(suffix:string)=>new RegExp('(?:'+names+')'+suffix,'g');
  const checks=[
    {pattern:re("(?:心想|心中|决定|答应|同意|接受|抱住|吻了|下旨|命令道|说道|说：|说“)"),reason:'正文可能替玩家角色决定、发言或接受接触'},
    {pattern:re("(?:的)?(?:脑子里|脑海里|脑海中|下意识|心底|心头)"),reason:'正文可能编造玩家角色的内心或自主行动'},
    {pattern:re("[^。！？!?；;\\n]{0,30}[，,]\\s*下意识"),reason:'正文可能编造玩家角色的自主行动'},
    ...(!/调查|查验|复核/.test(input)?[{pattern:/(?:调查|复核)(?:已经|已|终于)?(?:完成|查明)|坐实[^\n]*贪污/g,reason:'正文越过了尚未授权的调查结果'}]:[]),
  ];
  const issues:StoryBodyIssue[]=[];
  for(const {pattern,reason} of checks)for(const match of body.matchAll(pattern)){
    if(issues.length>=24)break;
    if(issues.some(i=>match.index>=i.start&&match.index<i.end))continue;
    let start=match.index,end=match.index+match[0].length;
    while(start>0&&!/[。！？!?；;\n]/.test(body[start-1]))start--;
    while(end<body.length&&!/[。！？!?；;\n]/.test(body[end]))end++;
    if(end<body.length&&body[end]!=='\n')end++;
    while(start<end&&/\s/.test(body[start]))start++;
    if(!issues.some(i=>i.start===start&&i.end===end))issues.push({start,end,quote:body.slice(start,end),reason});
  }
  return issues.sort((a,b)=>a.start-b.start);
}
