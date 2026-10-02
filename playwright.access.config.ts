import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { hashPassword } from './src/security/local';
export default defineConfig({
  testDir:'tests/access-e2e',outputDir:path.resolve('.test-data','access-results-'+Date.now()),workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:3218',channel:process.platform==='win32'?'msedge':undefined,headless:true,viewport:{width:390,height:844},trace:'retain-on-failure'},
  webServer:{command:'node scripts/serve.mjs start',url:'http://127.0.0.1:3218',reuseExistingServer:false,timeout:90000,env:{APP_PORT:'3218',APP_HOST:'127.0.0.1',APP_ACCESS_MODE:'lan',APP_ORIGINS:'http://127.0.0.1:3218',APP_PASSWORD_HASH:hashPassword('fixture-private-password'),APP_DATA_DIR:path.resolve('.test-data','access-'+Date.now()),SILICONFLOW_API_KEY:'',DEEPSEEK_API_KEY:'',GOOGLE_API_KEY:''}},
});
