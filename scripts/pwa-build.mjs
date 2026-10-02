import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),nextRequire=createRequire(require.resolve('next/package.json'));
const sharp=nextRequire('sharp');
mkdirSync('public/icons',{recursive:true});
for(const [name,size] of [['icon-192',192],['icon-512',512],['maskable-512',512],['apple-touch-icon',180]])await sharp('public/icons/engine-book.svg').resize(size,size).png().toFile('public/icons/'+name+'.png');
const version=readFileSync('.next/BUILD_ID','utf8').trim();
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(f=>f.isDirectory()?files(path.join(dir,f.name)):[path.join(dir,f.name)]);}
const assets=files('.next/static').filter(f=>/\.(js|css|woff2?)$/.test(f)).map(f=>'/'+f.replaceAll('\\','/').replace(/^\.next\//,'_next/'));
const template=readFileSync('scripts/sw-template.js','utf8');
writeFileSync('public/sw.js',template.replace('const version=__VERSION__,precache=__PRECACHE__','const version='+JSON.stringify(version)+',precache='+JSON.stringify(['/', '/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png','/icons/maskable-512.png','/icons/apple-touch-icon.png',...assets])));
console.log('PWA '+version+': '+assets.length+' static resources; /api is never cached.');
