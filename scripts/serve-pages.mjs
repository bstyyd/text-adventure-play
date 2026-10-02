import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('pages-site/out'),base='/text-adventure-play',port=Number(process.env.PAGES_TEST_PORT||3230);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
createServer(async(request,response)=>{
  try{
    let pathname=decodeURIComponent(new URL(request.url,'http://127.0.0.1').pathname);
    if(pathname===base){response.writeHead(302,{Location:base+'/'});response.end();return;}
    if(!pathname.startsWith(base+'/')||request.method!=='GET'){response.writeHead(404);response.end();return;}
    pathname=pathname.slice(base.length);let file=path.resolve(root,'.'+pathname);
    if(file!==root&&!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    response.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});response.end(await readFile(file));
  }catch{response.writeHead(404);response.end();}
}).listen(port,'127.0.0.1',()=>console.log('Static Pages test http://127.0.0.1:'+port+base+'/'));
