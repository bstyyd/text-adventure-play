import { createServer,request } from 'node:http';
import type { AddressInfo } from 'node:net';

// A disposable loopback origin forwards only to Playwright's isolated test server.
// Stopping it exercises real cache fallback without WebKit's setOffline bug (#42775).
export async function stoppableOrigin(target:string){
  const upstream=new URL(target);
  if(upstream.hostname!=='127.0.0.1'||!['3217','3221','3222'].includes(upstream.port))throw new Error('Offline fixture requires an isolated Playwright test server.');
  const server=createServer((req,res)=>{
    const headers={...req.headers,host:upstream.host};
    if(headers.origin)headers.origin=upstream.origin;
    const next=request({hostname:upstream.hostname,port:upstream.port,method:req.method,path:req.url,headers},response=>{
      res.writeHead(response.statusCode||502,response.headers);response.pipe(res);
    });
    next.on('error',()=>res.destroy());req.on('aborted',()=>next.destroy());req.pipe(next);
  });
  let port=0;
  const reconnect=()=>new Promise<void>((resolve,reject)=>{
    server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);port=(server.address() as AddressInfo).port;resolve();});
  });
  const disconnect=()=>new Promise<void>((resolve,reject)=>{if(!server.listening){resolve();return;}server.closeAllConnections();server.close(error=>error?reject(error):resolve());});
  await reconnect();return {url:'http://127.0.0.1:'+port,disconnect,reconnect,close:disconnect};
}
