import Database from 'better-sqlite3';
import {mkdirSync,readdirSync,writeFileSync,statSync,existsSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const root=process.env.APP_DATA_DIR;
if(process.env.APP_PLAYER_MODE!=='isolated'||!root||!path.isAbsolute(root))throw new Error('此命令仅用于明确配置数据目录的隔离分享站');
const name='site-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID().slice(0,8),target=path.join(root,'site-backups',name);
mkdirSync(target,{recursive:true,mode:0o700});
const players=path.join(root,'players');
const names=['access.sqlite',...(existsSync(players)?readdirSync(players,{withFileTypes:true}):[]).filter(f=>f.isDirectory()&&/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(f.name)&&existsSync(path.join(players,f.name,'dayao.sqlite'))).map(f=>'players/'+f.name+'/dayao.sqlite')];
const files=[];
for(const file of names){
  const source=path.join(root,file),out=path.join(target,file);mkdirSync(path.dirname(out),{recursive:true,mode:0o700});
  const db=new Database(source,{readonly:true,fileMustExist:true});
  try{await db.backup(out);}finally{db.close();}
  const check=new Database(out,{readonly:true,fileMustExist:true});
  try{if(check.pragma('integrity_check',{simple:true})!=='ok')throw new Error('备份完整性检查失败');}finally{check.close();}
  files.push({file,size:statSync(out).size,sha256:createHash('sha256').update(readFileSync(out)).digest('hex')});
}
writeFileSync(path.join(target,'manifest.json'),JSON.stringify({schemaVersion:1,at:new Date().toISOString(),files},null,2),{flag:'wx',mode:0o600});
console.log(JSON.stringify({ok:true,backup:target,databases:files.length}));
