import type { Metadata, Viewport } from 'next';
import './globals.css';
import {sitePath} from '../src/client/site-path';
export const metadata:Metadata={title:'互动小说 · 文字冒险',description:'一部由你执笔的长篇故事。自由交谈，留存往事。',manifest:sitePath('/manifest.webmanifest'),appleWebApp:{capable:true,title:'互动小说',statusBarStyle:'default'},icons:{icon:sitePath('/icons/icon-192.png'),apple:sitePath('/icons/apple-touch-icon.png')}};
export const viewport:Viewport={width:'device-width',initialScale:1,viewportFit:'cover',themeColor:'#faf8f2'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}
