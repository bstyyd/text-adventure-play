export {makeService} from '../server/make-service';
export function requestSecurity():never{throw new Error('浏览器版没有服务端接口');}
export function service():never{throw new Error('浏览器版必须使用自身的存档实例');}
export const deploymentStatus=()=>undefined;
export const draining=()=>false;
export function drain(){}
export const activeJobs=()=>0;
