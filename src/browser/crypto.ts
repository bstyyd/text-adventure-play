import {sha256} from '@noble/hashes/sha2.js';
import {Buffer} from 'buffer';
export function createHash(algorithm:string){
  if(algorithm!=='sha256')throw new Error('不支持的摘要算法');
  const chunks:Uint8Array[]=[];
  return {update(value:string|Uint8Array){chunks.push(typeof value==='string'?new TextEncoder().encode(value):value);return this;},digest(encoding?:string){const bytes=Buffer.from(sha256(Buffer.concat(chunks)));return encoding?bytes.toString(encoding as BufferEncoding):bytes;}};
}
export const randomUUID=()=>globalThis.crypto.randomUUID();
export const randomBytes=(size:number)=>Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)));
export function timingSafeEqual(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;}
export function scryptSync():never{throw new Error('浏览器版不运行服务器登录或口令哈希。');}
