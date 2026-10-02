import type { NextConfig } from 'next';
// Windows Next tracing does not normalize exclusion globs before matching. Build
// the regular local server there; the Linux deployment image uses standalone.
const config: NextConfig = { output:process.platform==='win32'?undefined:'standalone',serverExternalPackages: ['better-sqlite3'], poweredByHeader: false, devIndicators: false,
  env:{NEXT_PUBLIC_STATIC_PAGES:'false',NEXT_PUBLIC_BASE_PATH:''},
  outputFileTracingIncludes:{'/*':['./migrations/*.sql','./packages/dayao_empress/**']},
  outputFileTracingExcludes:{'**':['**/DayaoNovel/**','**/DayaoNovel-*/**','./.test-data/**','./artifacts/**','./spikes/**','./tests/**','./.git/**','**/*.sqlite*','**/*.db*','**/.env*','**/logs/**']},
  async headers(){return [{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/'}]},{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'},{key:'X-Frame-Options',value:'DENY'}]}];}
};
export default config;
