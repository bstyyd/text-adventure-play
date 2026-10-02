import {defineConfig} from '@playwright/test';
import path from 'node:path';
export default defineConfig({
  testDir:'tests/public-e2e',outputDir:path.resolve('.test-data','public-browser-results-'+Date.now()),workers:1,timeout:60000,
  use:{baseURL:'http://127.0.0.1:3220',channel:process.platform==='win32'?'msedge':undefined,headless:true,trace:'retain-on-failure'},
  webServer:{command:'node scripts/serve.mjs start',url:'http://127.0.0.1:3220',reuseExistingServer:false,timeout:90000,
    env:{APP_PORT:'3220',APP_HOST:'127.0.0.1',APP_ACCESS_MODE:'lan',APP_PLAYER_MODE:'isolated',APP_ORIGINS:'http://127.0.0.1:3220',
      APP_DATA_DIR:path.resolve('.test-data','public-browser-'+Date.now()),APP_SHARED_PROVIDER:'mock',APP_PASSWORD_HASH:'',APP_DEPLOY_TOKEN:'fixture-deployment-operations-token-32chars',
      SILICONFLOW_API_KEY:'',DEEPSEEK_API_KEY:'',GOOGLE_AI_API_KEY:'',GOOGLE_API_KEY:''}},
});
