import { defineConfig,devices } from '@playwright/test';
import base from './playwright.config';
import path from 'node:path';

// Desktop engines with device emulation; these runs are not physical phone tests.
export default defineConfig({
  ...base,testMatch:['mobile-pwa.spec.ts','scenarios.spec.ts'],outputDir:'test-results/mobile',timeout:90000,expect:{timeout:10000},
  projects:[
    {name:'webkit-phone',use:{...devices['iPhone 13'],browserName:'webkit',channel:undefined,baseURL:'http://127.0.0.1:3221'}},
    {name:'chromium-android',use:{...devices['Pixel 7'],browserName:'chromium',channel:process.platform==='win32'?'msedge':undefined,baseURL:'http://127.0.0.1:3222'}},
  ],
  use:{...base.use,channel:undefined,baseURL:'http://127.0.0.1:3221'},
  webServer:[3221,3222].map(port=>({command:'node scripts/serve.mjs start',url:'http://127.0.0.1:'+port,reuseExistingServer:false,timeout:90000,
    env:{APP_PORT:String(port),APP_DATA_DIR:path.resolve('.test-data','mobile-'+port+'-'+Date.now()),SILICONFLOW_API_KEY:'',DEEPSEEK_API_KEY:'',GOOGLE_API_KEY:''}})),
});
