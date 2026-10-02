import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const nextRequire=createRequire(require.resolve('next/package.json'));
nextRequire('@next/env').loadEnvConfig(process.cwd());
const port = process.env.APP_PORT || '3000';
const mode=process.env.APP_ACCESS_MODE||'local';
const host=process.env.APP_HOST||(mode==='lan'?'0.0.0.0':'127.0.0.1');
if(mode==='local'&&!['127.0.0.1','localhost','::1'].includes(host))throw new Error('对外监听须明确配置 APP_ACCESS_MODE=lan 或 public');
const isolated=process.env.APP_PLAYER_MODE==='isolated';
if(mode!=='local'&&(!process.env.APP_ORIGINS||(!isolated||process.env.APP_PASSWORD_HASH)&&!/^scrypt:v1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(process.env.APP_PASSWORD_HASH||'')))throw new Error('请配置 APP_ORIGINS 和有效登录口令；隔离访客模式可不设口令');
if(mode==='public'&&(!process.env.APP_DATA_DIR||process.env.APP_ORIGINS.split(',').some(o=>!o.trim().startsWith('https://'))))throw new Error('公网需要 HTTPS 域名和持久 APP_DATA_DIR');
if(isolated&&mode==='public'){
  const provider=process.env.APP_SHARED_PROVIDER;
  if(!['siliconflow','deepseek','google-gemma'].includes(provider))throw new Error('正式分享站须配置真实 APP_SHARED_PROVIDER');
  if(provider!=='google-gemma'&&!process.env.APP_SHARED_MODEL)throw new Error('须显式配置 APP_SHARED_MODEL');
  const configured=provider==='siliconflow'?process.env.SILICONFLOW_API_KEY:provider==='deepseek'?process.env.DEEPSEEK_API_KEY:process.env.GOOGLE_AI_API_KEY||process.env.GOOGLE_API_KEY;
  if(!configured)throw new Error('站长模型密钥尚未配置');
}
const logDir=path.join(process.env.APP_DATA_DIR||path.join(homedir(),'DayaoNovel'),'logs');
mkdirSync(logDir,{recursive:true});
const logFile=path.join(logDir,'lifecycle-'+new Date().toISOString().replaceAll(':','-')+'.log');
// Record lifecycle metadata only. Never copy request bodies, credentials or raw provider errors.
const record=event=>appendFileSync(logFile,JSON.stringify({at:new Date().toISOString(),pid:process.pid,...event})+'\n',{encoding:'utf8',mode:0o600});
record({event:'starting',mode,host,port});console.log('服务生命周期日志：'+logFile);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), process.argv[2] || 'dev', '--hostname', host, '--port', port, ...(process.argv[2] === 'dev' ? ['--webpack'] : [])], {stdio:'inherit',windowsHide:true});
child.on('spawn',()=>record({event:'spawned',childPid:child.pid}));
child.on('error',error=>{record({event:'spawn-failed',code:error.code||'UNKNOWN'});process.exitCode=1;});
child.on('exit', (code,signal) => {record({event:'exited',code,signal});process.exit(code ?? 1);});
process.on('SIGINT', () => {record({event:'stop-requested',signal:'SIGINT'});child.kill('SIGINT');});
process.on('SIGTERM', () => {record({event:'stop-requested',signal:'SIGTERM'});child.kill('SIGTERM');});
