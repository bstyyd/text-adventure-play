import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Repository } from '../src/storage/repository';
const mode=process.argv[2];
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
if(mode==='backup'){
  const repo=new Repository(undefined,{recoverDrafts:false});console.log(await repo.backup());repo.close();
}else if(mode==='restore'){
  const source=process.argv[3],destination=process.argv[4];
  if(!source||!destination)throw new Error('用法：pnpm restore <完整备份.sqlite> <新的数据目录>');
  const target=path.resolve(destination),file=path.join(target,'dayao.sqlite');
  if(existsSync(file)||existsSync(file+'-wal')||existsSync(file+'-shm'))throw new Error('目标已有数据库；恢复只允许新目录，不覆盖。');
  const check=new Database(path.resolve(source),{readonly:true,fileMustExist:true});
  if(check.pragma('integrity_check',{simple:true})!=='ok'||![1,2,3].includes(check.pragma('user_version',{simple:true}) as number))throw new Error('备份完整性或版本校验失败。');
  check.close();mkdirSync(target,{recursive:true});copyFileSync(path.resolve(source),file,1);
  console.log('已恢复到 '+target+'。用 APP_DATA_DIR 指向此目录后启动。原数据未改动。');
}else throw new Error('未知数据命令');
