import {PACKAGE_LIMITS,safePackagePath} from './package';
const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes:Uint8Array){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
export type ZipEntry={name:string;size:number;crc:number;directory:boolean};
// Validate the directory before inflation. Nothing is extracted to disk.
export function inspectZip(bytes:Uint8Array):Map<string,ZipEntry>{
 const b=Buffer.from(bytes),u16=(i:number)=>b.readUInt16LE(i),u32=(i:number)=>b.readUInt32LE(i);
 if(b.length<22||b.length>PACKAGE_LIMITS.zip)throw new Error('ZIP 缺失、截断或超过大小限制');
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(u32(i)===0x06054b50&&i+22+u16(i+20)===b.length){end=i;break;}
 if(end<0)throw new Error('ZIP 目录不完整，不能导入截断文件');
 if(u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))throw new Error('不支持多卷 ZIP');
 const count=u16(end+10),size=u32(end+12),offset=u32(end+16);if(!count||count>PACKAGE_LIMITS.files||offset+size!==end)throw new Error('ZIP 文件过多或目录无效');
 const entries=new Map<string,ZipEntry>();let at=offset,total=0;
 for(let i=0;i<count;i++){
  if(at+46>end||u32(at)!==0x02014b50)throw new Error('ZIP 目录损坏');
  const flags=u16(at+8),method=u16(at+10),crc=u32(at+16),compressed=u32(at+20),original=u32(at+24),nl=u16(at+28),xl=u16(at+30),cl=u16(at+32),mode=u32(at+38)>>>16,local=u32(at+42);
  if(at+46+nl+xl+cl>end||local+30>offset||u16(at+34)||flags&0x0041||![0,8].includes(method))throw new Error('拒绝加密、分卷或不支持的压缩格式');
  if(mode&0xf000&&(mode&0xf000)!==0x8000&&(mode&0xf000)!==0x4000)throw new Error('ZIP 不允许符号链接或特殊文件');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(at+46,at+46+nl)),directory=name.endsWith('/');safePackagePath(directory?name.slice(0,-1):name);
  if(entries.has(name))throw new Error('ZIP 路径重复');
  if(!directory&&!/\.(json|md|txt|png|jpe?g|webp)$/i.test(name))throw new Error('剧本禁止代码／SQL／HTML 与可执行文件');
  const limit=/\.(png|jpe?g|webp)$/i.test(name)?PACKAGE_LIMITS.image:PACKAGE_LIMITS.text;
  total+=original;if(original>limit||total>PACKAGE_LIMITS.total||directory&&original)throw new Error('解压后的剧本文件过大');
  if(u32(local)!==0x04034b50||u16(local+6)!==flags||u16(local+8)!==method)throw new Error('ZIP 文件头与目录不一致');
  const ln=u16(local+26),lx=u16(local+28),payload=local+30+ln+lx;
  if(payload+compressed>offset||!b.subarray(local+30,local+30+ln).equals(b.subarray(at+46,at+46+nl)))throw new Error('ZIP 本地路径或数据范围无效');
  entries.set(name,{name,size:original,crc,directory});at+=46+nl+xl+cl;
 }
 if(at!==end)throw new Error('ZIP 目录大小不一致');return entries;
}
