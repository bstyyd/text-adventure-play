import Database from 'better-sqlite3';
import {existsSync,readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const source=process.argv[2],destination=process.argv[3];
if(!source||!destination)throw new Error('用法：node scripts/site-restore.mjs <完整分享站备份目录> <新的空数据目录>');
const root=realpathSync(source),target=path.resolve(destination);
if(existsSync(target))throw new Error('目标目录已存在；只恢复到新目录，不覆盖当前服务');
const m=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
if(m.schemaVersion!==1||!Array.isArray(m.files)||!m.files.length||m.files.length>1001)throw new Error('备份清单无效');
const files=[],names=new Set();
for(const f of m.files){
  if(typeof f.file!=='string'||!(f.file==='access.sqlite'||/^players\/[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}\/dayao\.sqlite$/.test(f.file))||names.has(f.file))throw new Error('非法或重复的备份路径');
  names.add(f.file);const file=path.join(root,f.file);
  if(lstatSync(file).isSymbolicLink()||!realpathSync(file).startsWith(root+path.sep))throw new Error('禁止外部文件或链接');
  const data=readFileSync(file);
  if(data.length!==f.size||createHash('sha256').update(data).digest('hex')!==f.sha256)throw new Error('备份完整性校验失败');
  const db=new Database(file,{readonly:true,fileMustExist:true});
  try{if(db.pragma('integrity_check',{simple:true})!=='ok')throw new Error('SQLite 完整性失败');
    if(f.file!=='access.sqlite'&&db.pragma('user_version',{simple:true})!==3)throw new Error('存档版本不受支持');
  }finally{db.close();}
  files.push({file:f.file,data});
}
if(!names.has('access.sqlite'))throw new Error('缺少身份和限额数据库');
// Verify all input before creating any target files. Existing paths remain untouched.
mkdirSync(target,{recursive:false,mode:0o700});
for(const f of files){const file=path.join(target,f.file);mkdirSync(path.dirname(file),{recursive:true,mode:0o700});writeFileSync(file,f.data,{flag:'wx',mode:0o600});}
console.log(JSON.stringify({ok:true,target,databases:files.length}));
