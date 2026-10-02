'use client';
import { useEffect } from 'react';
export function useVisualViewport(){
  useEffect(()=>{
    const viewport=window.visualViewport,root=document.documentElement;
    function resize(){
      // Respect pinch zoom. Do not resize or scroll the app to counteract it.
      if(viewport&&viewport.scale!==1)return;
      root.style.setProperty('--app-height',(viewport?.height||window.innerHeight)+'px');
      root.style.setProperty('--app-top',(viewport?.offsetTop||0)+'px');
      const keyboard=!!viewport&&window.innerHeight-viewport.height>150;
      root.dataset.keyboard=String(keyboard);
    }
    resize();viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);window.addEventListener('resize',resize);window.addEventListener('orientationchange',resize);
    return()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);window.removeEventListener('resize',resize);window.removeEventListener('orientationchange',resize);};
  },[]);
}
