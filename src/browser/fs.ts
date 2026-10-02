import {browserFiles} from './data.generated';
export function readFileSync(file:string){const key=file.replaceAll('\\','/'),data=browserFiles[key]??browserFiles['/app'+key];if(data===undefined)throw new Error('浏览器版不能读取电脑文件：'+file);return data;}
export function mkdirSync(){}
export function readdirSync(){return [] as string[];}
export function existsSync(file:string){return Object.hasOwn(browserFiles,file);}
export function unlinkSync():never{throw new Error('浏览器版不能删除电脑文件。');}
