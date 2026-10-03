import { describe,it,expect,vi } from 'vitest';
import type { GoogleGenAI } from '@google/genai';
import { DeepSeekProvider,SiliconFlowProvider,decodeSSE,retryDelay } from '../../src/llm/chat-completions';
import { GoogleGemmaProvider } from '../../src/llm/google-gemma';
import { DEFAULT_PROFILES } from '../../src/llm/config';
import { textRequest } from '../helpers';
const good=(content='小说正文',finish='stop')=>({id:'fixture-id',choices:[{message:{content,reasoning_content:'DO_NOT_SHOW'},finish_reason:finish}],usage:{prompt_tokens:15,completion_tokens:9}});
describe.each([{name:'DeepSeek',Provider:DeepSeekProvider,profile:DEFAULT_PROFILES[2],url:'https://api.deepseek.com/chat/completions'},{name:'硅基流动',Provider:SiliconFlowProvider,profile:{...DEFAULT_PROFILES[1],model:'Pro/vendor/full-model'},url:'https://api.siliconflow.cn/v1/chat/completions'}])('$name mock HTTP contract F01 F02 F06 F10–F12',({Provider,profile,url})=>{
  it('preserves the global receiver required by native browser fetch',async()=>{
    const fetcher=vi.fn<typeof fetch>(function(this:unknown){
      if(this!==globalThis)throw new TypeError('Illegal invocation');
      return Promise.resolve(Response.json(good()));
    });
    await expect(new Provider(fetcher).testConnection(textRequest(profile))).resolves.toMatchObject({text:'小说正文'});
  });
  it('endpoint, bearer, model and reasoning exclusion',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json(good()));
    const p=new Provider(fetcher),r=await p.generateText(textRequest(profile));
    expect(fetcher.mock.calls[0][0]).toBe(url);const init=fetcher.mock.calls[0][1]!;
    expect(init.headers).toMatchObject({Authorization:'Bearer fixture-secret'});expect(JSON.parse(init.body as string).model).toBe(profile.model);
    expect(JSON.parse(init.body as string).max_tokens).toBe(profile.maxOutputTokens);
    expect(JSON.stringify(r)).not.toContain('DO_NOT_SHOW');expect(r.text).toBe('小说正文');
  });
  it.each([401,403,404,400])('status %i never retries or switches',async status=>{const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status}));await expect(new Provider(f).generateText(textRequest(profile))).rejects.toMatchObject({status});expect(f).toHaveBeenCalledTimes(1);});
  it.each([['','stop'],['部分','length'],['拒绝','content_filter']])('empty/truncated/refused %s %s rejected',async(text,finish)=>{const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json(good(text,finish)));await expect(new Provider(f).generateText(textRequest(profile))).rejects.toThrow();});
  it('429 retries once, preserving Retry-After bound',async()=>{const f=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:429,headers:{'Retry-After':'0'}})).mockResolvedValueOnce(Response.json(good()));let attempts=0;const r=await new Provider(f).generateText({...textRequest(profile),onAttempt:()=>attempts++});expect(f).toHaveBeenCalledTimes(2);expect(r.requestCount).toBe(2);expect(attempts).toBe(2);});
  it('second failure stops; long retry-after asks user to retry',async()=>{const f=vi.fn<typeof fetch>().mockImplementation(async()=>new Response('',{status:503,headers:{'Retry-After':'0'}}));await expect(new Provider(f).generateText(textRequest(profile))).rejects.toThrow();expect(f).toHaveBeenCalledTimes(2);const long=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status:429,headers:{'Retry-After':'90'}}));await expect(new Provider(long).generateText(textRequest(profile))).rejects.toThrow();expect(long).toHaveBeenCalledTimes(1);expect(retryDelay('2')).toBe(2000);});
  it('pre-cancelled signal does not contact upstream',async()=>{const f=vi.fn<typeof fetch>(),c=new AbortController();c.abort();await expect(new Provider(f).generateText({...textRequest(profile),signal:c.signal})).rejects.toThrow();expect(f).not.toHaveBeenCalled();});
  it('non-streamed model computation may exceed the connection timeout',async()=>{
    const f=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>resolve(Response.json(good())),40);
      init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(init.signal?.reason);},{once:true});
    }));
    const result=await new Provider(f).extractJson(textRequest({...profile,connectTimeoutMs:5,timeoutMs:1000}));
    expect(result.text).toBe('小说正文');expect(f).toHaveBeenCalledTimes(1);
  });
  it('total timeout is classified separately from cancellation',async()=>{
    const f=vi.fn<typeof fetch>().mockImplementation((_url,init)=>new Promise((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});
    }));
    await expect(new Provider(f).generateText(textRequest({...profile,timeoutMs:30,connectTimeoutMs:5}))).rejects.toMatchObject({code:'TIMEOUT'});
    const controller=new AbortController();
    const request=new Provider(f).generateText({...textRequest(profile),signal:controller.signal});
    controller.abort();await expect(request).rejects.toMatchObject({code:'CANCELLED'});
  });
  it('non-streamed token limit retains visible partial text and the finish reason',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json(good('尚未说完的半句话','length')));
    await expect(new Provider(f).generateText(textRequest(profile))).rejects.toMatchObject({code:'OUTPUT_LIMIT',partialText:'尚未说完的半句话',finishReason:'length'});
  });
  it('oversized incomplete responses never bypass the local draft limit',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json(good('字'.repeat(100001),'length')));
    await expect(new Provider(f).generateText(textRequest(profile))).rejects.toMatchObject({code:'TOO_LARGE',partialText:'字'.repeat(100000)});
  });
  it('total timeout during retry backoff stops before a second request',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status:503,headers:{'Retry-After':'1'}}));
    await expect(new Provider(f).generateText(textRequest({...profile,timeoutMs:30}))).rejects.toMatchObject({code:'TIMEOUT'});
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('unknown capability sends no schema or thinking parameters',async()=>{const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json(good()));const req=textRequest(profile);await new Provider(f).extractJson({...req,format:'json_schema',schema:{},capabilities:{...req.capabilities,jsonSchema:'unknown',jsonObject:'unknown'}});expect(JSON.parse(f.mock.calls[0][1]!.body as string)).not.toHaveProperty('response_format');expect(JSON.parse(f.mock.calls[0][1]!.body as string)).not.toHaveProperty('thinking');});
});
describe('SSE fixtures F08 F09 F10',()=>{
  const makeStream=(value:string,size=1)=>{const bytes=new TextEncoder().encode(value);return new ReadableStream<Uint8Array>({start(c){for(let i=0;i<bytes.length;i+=size)c.enqueue(bytes.slice(i,i+size));c.close();}});};
  it('an oversized stream retains a bounded incomplete draft',async()=>{
    const frame=(text:string)=>'data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\n\n';
    const frames=frame('字'.repeat(25000)).repeat(4)+frame('末');
    const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(makeStream(frames,4096)));
    const consume=async()=>{for await(const event of new DeepSeekProvider(f).streamText(textRequest(DEFAULT_PROFILES[2])))void event;};
    await expect(consume()).rejects.toMatchObject({code:'TOO_LARGE',partialText:'字'.repeat(100000)});
  });
  it('UTF-8 and CRLF split at arbitrary bytes; ignores reasoning and empty deltas',async()=>{
    const frames=[{choices:[{delta:{reasoning_content:'secret-thinking'}}]},{choices:[{delta:{content:'灯影，'}}]},{choices:[{delta:{}}]},{choices:[{delta:{content:'未央。'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:1,completion_tokens:2}}].map(v=>'data: '+JSON.stringify(v)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n';
    const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(makeStream(frames)));
    const events=[];for await(const e of new DeepSeekProvider(f).streamText(textRequest(DEFAULT_PROFILES[2])))events.push(e);
    expect(events.filter(e=>e.type==='delta').map(e=>e.type==='delta'?e.text:'').join('')).toBe('灯影，未央。');
    expect(JSON.stringify(events)).not.toContain('secret-thinking');expect(events.at(-1)).toMatchObject({type:'complete',result:{usage:{input:1,output:2}}});
  });
  it('missing terminator and malformed frame fail',async()=>{const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(makeStream('data: {"choices":[{"delta":{"content":"草稿"}}]}\n\n')));const consume=async()=>{for await(const e of new DeepSeekProvider(f).streamText(textRequest(DEFAULT_PROFILES[2])))void e;};await expect(consume()).rejects.toThrow(/中断/);const truncated=async()=>{for await(const e of decodeSSE(makeStream('data: {'),new AbortController().signal))void e;};await expect(truncated()).rejects.toThrow(/不完整/);});
  it('unknown streaming uses one complete response, not fake deltas',async()=>{const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json(good()));const request=textRequest({...DEFAULT_PROFILES[1],model:'vendor/model'}),events=[];for await(const e of new SiliconFlowProvider(f).streamText(request))events.push(e);expect(events).toHaveLength(1);expect(events[0].type).toBe('complete');});
  it.each(['stop','length',undefined])('EOF without DONE never commits, even with finish=%s',async finish=>{
    const frame='data: '+JSON.stringify({choices:[{delta:{content:'未确认完整的正文'},finish_reason:finish}]})+'\n\n';
    const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(makeStream(frame)));
    const consume=async()=>{for await(const event of new DeepSeekProvider(f).streamText(textRequest(DEFAULT_PROFILES[2])))void event;};
    await expect(consume()).rejects.toMatchObject({code:'STREAM_TRUNCATED',partialText:'未确认完整的正文'});
  });
  it('DONE with token-limit reason retains the partial draft',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(makeStream('data: '+JSON.stringify({choices:[{delta:{content:'尚未完整'},finish_reason:'length'}]})+'\n\ndata: [DONE]\n\n')));
    const consume=async()=>{for await(const event of new DeepSeekProvider(f).streamText(textRequest(DEFAULT_PROFILES[2])))void event;};
    await expect(consume()).rejects.toMatchObject({code:'OUTPUT_LIMIT',partialText:'尚未完整',finishReason:'length'});
  });
  it('reasoning and heartbeats do not count as the first visible character',async()=>{
    let timer:ReturnType<typeof setInterval>;
    const body=new ReadableStream<Uint8Array>({start(c){timer=setInterval(()=>c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"not prose"}}]}\n\n')),5);},cancel(){clearInterval(timer);}});
    const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    const consume=async()=>{for await(const event of new DeepSeekProvider(f).streamText(textRequest({...DEFAULT_PROFILES[2],firstTextTimeoutMs:35,timeoutMs:500})))void event;};
    await expect(consume()).rejects.toMatchObject({code:'FIRST_TEXT_TIMEOUT',partialText:''});
  });
  it('total stream timeout retains delivered characters and never reports completion',async()=>{
    const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已经收到的部分"}}]}\n\n'));}});
    const f=vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
    const consume=async()=>{for await(const event of new DeepSeekProvider(f).streamText(textRequest({...DEFAULT_PROFILES[2],timeoutMs:45})))void event;};
    await expect(consume()).rejects.toMatchObject({code:'TIMEOUT',partialText:'已经收到的部分'});
  });
});
describe('Google Gemma native SDK fixtures F03 F04 F14',()=>{
  it('model listing preserves the native browser fetch receiver',async()=>{
    const fetcher=vi.fn<typeof fetch>(function(this:unknown){
      if(this!==globalThis)throw new TypeError('Illegal invocation');
      return Promise.resolve(Response.json({models:[]}));
    });
    await expect(new GoogleGemmaProvider(undefined,fetcher).listModels(textRequest(DEFAULT_PROFILES[3]))).resolves.toMatchObject({status:'supported'});
  });
  it('official SDK issues native endpoint and API-key header using mocked HTTP',async()=>{
    const f=vi.fn<typeof fetch>().mockResolvedValue(Response.json({candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'原生返回'}]}}]}));
    vi.stubGlobal('fetch',f);
    try{
      const result=await new GoogleGemmaProvider().generateText(textRequest(DEFAULT_PROFILES[3]));
      expect(result.text).toBe('原生返回');
      expect(String(f.mock.calls[0][0])).toContain('/v1beta/models/gemma-4-26b-a4b-it:generateContent');
      const headers=new Headers(f.mock.calls[0][1]?.headers);
      expect(headers.get('x-goog-api-key')).toBe('fixture-secret');
      expect(headers.has('authorization')).toBe(false);
    }finally{vi.unstubAllGlobals();}
  });
  function fixture(result:unknown={candidates:[{finishReason:'STOP',content:{parts:[{text:'隐藏思考',thought:true},{text:'灯下正文'}]}}],usageMetadata:{promptTokenCount:10,candidatesTokenCount:4}}){
    const generateContent=vi.fn().mockResolvedValue(result),client={models:{generateContent}} as unknown as GoogleGenAI;
    return {provider:new GoogleGemmaProvider(()=>client),generateContent};
  }
  it('native model/user roles, separate system, no OpenAI key or thought output',async()=>{const f=fixture(),r=await f.provider.generateText(textRequest(DEFAULT_PROFILES[3]));const request=f.generateContent.mock.calls[0][0];expect(request.model).toBe('gemma-4-26b-a4b-it');expect(request.contents.map((m:{role:string})=>m.role)).toEqual(['user','model','user']);expect(request.config.systemInstruction).toBe('叙事规则');expect(request).not.toHaveProperty('messages');expect(r.text).toBe('灯下正文');expect(request.config).not.toHaveProperty('thinkingConfig');expect(request.config).not.toHaveProperty('responseMimeType');});
  it.each(['MAX_TOKENS','SAFETY','RECITATION'])('finish %s is not accepted',async reason=>{await expect(fixture({candidates:[{finishReason:reason,content:{parts:[{text:'partial'}]}}]}).provider.generateText(textRequest(DEFAULT_PROFILES[3]))).rejects.toThrow();});
  it('empty output fails',async()=>{await expect(fixture({candidates:[{finishReason:'STOP',content:{parts:[]}}]}).provider.generateText(textRequest(DEFAULT_PROFILES[3]))).rejects.toThrow(/空/);});
  it('error mapping does not reveal raw SDK error/key',async()=>{const f=fixture();f.generateContent.mockRejectedValue({status:401,message:'fixture-secret'});await expect(f.provider.generateText(textRequest(DEFAULT_PROFILES[3]))).rejects.toMatchObject({status:401,message:'密钥无效或已失效。'});});
  it('abort before generation does not contact SDK',async()=>{const f=fixture(),c=new AbortController();c.abort();await expect(f.provider.generateText({...textRequest(DEFAULT_PROFILES[3]),signal:c.signal})).rejects.toThrow();expect(f.generateContent).not.toHaveBeenCalled();});
  it('paged model list uses x-goog-api-key and retains Gemma',async()=>{const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({models:[{name:'models/other',supportedGenerationMethods:['generateContent']}],nextPageToken:'next page'})).mockResolvedValueOnce(Response.json({models:[{name:'models/gemma-4-26b-a4b-it',supportedGenerationMethods:['generateContent']}]}));const p=new GoogleGemmaProvider(undefined,fetcher);const result=await p.listModels(textRequest(DEFAULT_PROFILES[3]));expect(result.models.map(m=>m.id)).toContain('gemma-4-26b-a4b-it');expect(fetcher.mock.calls[1][0]).toContain('pageToken=next%20page');expect(fetcher.mock.calls[0][1]!.headers).toEqual({'x-goog-api-key':'fixture-secret'});expect(fetcher.mock.calls[0][0]).not.toContain('fixture-secret');});
  it('connection test contains no story or prior conversation',async()=>{const f=fixture();await f.provider.testConnection(textRequest(DEFAULT_PROFILES[3]));expect(JSON.stringify(f.generateContent.mock.calls[0][0])).not.toContain('已采用正文');});
});
