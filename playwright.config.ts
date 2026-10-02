import { defineConfig } from '@playwright/test';
import path from 'node:path';
const runDir=path.resolve('.test-data','e2e-'+Date.now());
export default defineConfig({
  testDir:'tests/e2e',outputDir:'test-results/desktop',timeout:45000,fullyParallel:false,workers:1,retries:0,
  use:{baseURL:'http://127.0.0.1:3217',channel:process.platform==='win32'?'msedge':undefined,headless:true,viewport:{width:1440,height:1000},trace:'retain-on-failure'},
  webServer:{command:'node scripts/serve.mjs start',url:'http://127.0.0.1:3217',reuseExistingServer:false,timeout:90000,env:{APP_PORT:'3217',APP_DATA_DIR:runDir,SILICONFLOW_API_KEY:'',DEEPSEEK_API_KEY:'',GOOGLE_API_KEY:''}},
});
