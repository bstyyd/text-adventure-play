import {defineConfig} from '@playwright/test';
import path from 'node:path';
const deployedURL=process.env.PAGES_TEST_URL;
if(deployedURL&&deployedURL!=='https://bstyyd.github.io/text-adventure-play/')throw new Error('PAGES_TEST_URL 必须是本项目的实际 GitHub Pages 地址');
export default defineConfig({testDir:'tests/pages-e2e',outputDir:path.resolve('.test-data','pages-browser-results-'+Date.now()),workers:1,timeout:90000,
  use:{baseURL:deployedURL||'http://127.0.0.1:3230/text-adventure-play/',channel:process.platform==='win32'?'msedge':undefined,headless:true,trace:'retain-on-failure'},
  webServer:deployedURL?undefined:{command:'node scripts/serve-pages.mjs',url:'http://127.0.0.1:3230/text-adventure-play/',reuseExistingServer:false,timeout:30000},
});
