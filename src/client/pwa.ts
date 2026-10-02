'use client';
import { useEffect, useRef, useState } from 'react';
import {sitePath} from './site-path';

type InstallPrompt=Event&{prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
export type PwaRuntime={
  available:boolean;ready:boolean;installed:boolean;canInstall:boolean;error:string;
  install:()=>Promise<void>;update:()=>void;
};

// Keep these listeners alive while reading, not just while Settings is mounted.
export function usePwa():PwaRuntime{
  const [available,setAvailable]=useState(false),[ready,setReady]=useState(false);
  const [installed,setInstalled]=useState(false),[canInstall,setCanInstall]=useState(false),[error,setError]=useState('');
  const promptRef=useRef<InstallPrompt|null>(null),registrationRef=useRef<ServiceWorkerRegistration|null>(null);
  useEffect(()=>{
    let live=true,registering=false,cleanRegistration=()=>{};
    const standalone=window.matchMedia('(display-mode: standalone)');
    const detectInstalled=()=>setInstalled(standalone.matches||!!(navigator as Navigator&{standalone?:boolean}).standalone);
    const prompt=(event:Event)=>{event.preventDefault();promptRef.current=event as InstallPrompt;setCanInstall(true);};
    const done=()=>{setInstalled(true);promptRef.current=null;setCanInstall(false);};
    window.addEventListener('beforeinstallprompt',prompt);window.addEventListener('appinstalled',done);
    standalone.addEventListener('change',detectInstalled);detectInstalled();
    async function register(){
      if(registering||!('serviceWorker' in navigator)||!window.isSecureContext||process.env.NODE_ENV!=='production')return;
      registering=true;
      try{
        const previous=await navigator.serviceWorker.getRegistration(sitePath('/'));
        // navigator.onLine can stay true when only the story server is unavailable.
        if(live&&previous){registrationRef.current=previous;setReady(!!previous.active);setAvailable(!!previous.waiting);}
        const reg=navigator.onLine?await navigator.serviceWorker.register(sitePath('/sw.js'),{scope:sitePath('/'),updateViaCache:'none'}):previous;
        if(!live||!reg)return;
        cleanRegistration();registrationRef.current=reg;setError('');
        const workers=new Set<ServiceWorker>();
        const sync=()=>{if(live){setReady(!!reg.active);setAvailable(!!reg.waiting);}};
        const watch=()=>{const next=reg.installing;if(next&&!workers.has(next)){workers.add(next);next.addEventListener('statechange',sync);}sync();};
        reg.addEventListener('updatefound',watch);navigator.serviceWorker.addEventListener('controllerchange',sync);watch();
        void navigator.serviceWorker.ready.then(()=>{if(live)sync();});
        cleanRegistration=()=>{reg.removeEventListener('updatefound',watch);navigator.serviceWorker.removeEventListener('controllerchange',sync);workers.forEach(worker=>worker.removeEventListener('statechange',sync));};
      }catch{if(live&&!registrationRef.current?.active)setError('离线应用资源安装失败；在线功能仍可使用，恢复连接后会重试资源下载。');}
      finally{registering=false;}
    }
    const reconnected=(event:Event)=>{if((event as CustomEvent<boolean>).detail===false)void register();};
    void register();window.addEventListener('online',register);window.addEventListener('dayao-connectivity',reconnected);
    return()=>{live=false;cleanRegistration();window.removeEventListener('online',register);window.removeEventListener('dayao-connectivity',reconnected);window.removeEventListener('beforeinstallprompt',prompt);window.removeEventListener('appinstalled',done);standalone.removeEventListener('change',detectInstalled);};
  },[]);
  async function install(){
    const prompt=promptRef.current;if(!prompt)return;
    promptRef.current=null;setCanInstall(false);
    try{await prompt.prompt();await prompt.userChoice;}
    catch{setError('浏览器未完成安装；仍可在线游玩，或使用浏览器菜单添加到主屏幕。');}
  }
  function update(){
    const worker=registrationRef.current?.waiting;
    if(!worker){setAvailable(false);return;}
    // Only this explicit action reloads. Updates in other tabs never force a reload.
    navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload(),{once:true});
    worker.postMessage({type:'ACTIVATE_UPDATE'});
  }
  return {available,ready,installed,canInstall,error,install,update};
}
