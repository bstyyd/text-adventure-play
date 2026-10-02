export const sep='/';
function normalize(value:string){const parts:string[]=[];for(const p of value.replaceAll('\\','/').split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return '/'+parts.join('/');}
export const join=(...parts:string[])=>normalize(parts.join('/'));
export const resolve=(...parts:string[])=>join(...parts);
export const dirname=(value:string)=>normalize(value).split('/').slice(0,-1).join('/')||'/';
const browserPath={sep,join,resolve,dirname};
export default browserPath;
