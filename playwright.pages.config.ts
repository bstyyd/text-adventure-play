import {defineConfig} from '@playwright/test';
import path from 'node:path';
export default defineConfig({testDir:'tests/pages-e2e',outputDir:path.resolve('.test-data','pages-browser-results-'+Date.now()),workers:1,timeout:90000,
  use:{baseURL:'http://127.0.0.1:3230/text-adventure-play/',channel:process.platform==='win32'?'msedge':undefined,headless:true,trace:'retain-on-failure'},
  webServer:{command:'node scripts/serve-pages.mjs',url:'http://127.0.0.1:3230/text-adventure-play/',reuseExistingServer:false,timeout:30000},
});
