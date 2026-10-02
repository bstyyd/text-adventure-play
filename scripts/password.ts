import { hashPassword } from '../src/security/local';
// stdin raw mode avoids shell history and on-screen password echo. Print only the hash.
if(!process.stdin.isTTY)throw new Error('请在交互终端运行 pnpm password，口令不放在命令行中。');
process.stdout.write('设置个人书库口令（12–256字符，输入不回显）：');
process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');let password='';
process.stdin.on('data',(chunk:string)=>{
  for(const char of chunk){
    if(char==='\u0003'){process.stdin.setRawMode(false);process.exit(130);}
    if(char==='\r'||char==='\n'){
      process.stdin.setRawMode(false);process.stdin.pause();
      try{process.stdout.write('\nAPP_PASSWORD_HASH='+hashPassword(password)+'\n');password='';process.exit(0);}catch(e){process.stderr.write('\n'+(e as Error).message+'\n');process.exit(1);}
    }else if(char==='\u007f'||char==='\b')password=password.slice(0,-1);
    else if(char>=' '&&password.length<256)password+=char;
  }
});
