// OPTIONS only: no key, generation request or billable model call.
const origin='https://bstyyd.github.io';
const providers=[
  ['siliconflow','https://api.siliconflow.cn/v1/chat/completions','authorization,content-type'],
  ['deepseek','https://api.deepseek.com/chat/completions','authorization,content-type'],
  ['google-gemma','https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:streamGenerateContent?alt=sse','content-type,x-goog-api-key'],
];
await Promise.all(providers.map(async([provider,url,headers])=>{
  try{
    const response=await fetch(url,{method:'OPTIONS',redirect:'error',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':headers},signal:AbortSignal.timeout(15000)});
    console.log(JSON.stringify({provider,status:response.status,origin:response.headers.get('access-control-allow-origin'),methods:response.headers.get('access-control-allow-methods'),headers:response.headers.get('access-control-allow-headers'),billableRequest:false}));
  }catch{console.log(JSON.stringify({provider,error:'OPTIONS 检查未完成',billableRequest:false}));}
}));
