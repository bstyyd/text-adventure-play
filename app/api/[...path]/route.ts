import {handle} from '@/server/api-handler';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{path:string[]}>}){return handle(request,(await context.params).path);}
export async function POST(request:Request,context:{params:Promise<{path:string[]}>}){return handle(request,(await context.params).path);}
