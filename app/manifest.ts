import type { MetadataRoute } from 'next';
import {sitePath} from '../src/client/site-path';
export default function manifest():MetadataRoute.Manifest{
  return {id:sitePath('/'),name:'互动小说 · 文字冒险',short_name:'互动小说',description:'自由交谈，留存往事。',lang:'zh-CN',start_url:sitePath('/'),scope:sitePath('/'),display:'standalone',background_color:'#faf8f2',theme_color:'#faf8f2',icons:[{src:sitePath('/icons/icon-192.png'),sizes:'192x192',type:'image/png',purpose:'any'},{src:sitePath('/icons/icon-512.png'),sizes:'512x512',type:'image/png',purpose:'any'},{src:sitePath('/icons/maskable-512.png'),sizes:'512x512',type:'image/png',purpose:'maskable'}]};
}
