export const browserEdition=()=>process.env.NEXT_PUBLIC_STATIC_PAGES==='true';
export function sitePath(value:string){return (process.env.NEXT_PUBLIC_BASE_PATH||'')+value;}
