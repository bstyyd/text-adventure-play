import type {NextConfig} from 'next';
import path from 'node:path';
const root=path.resolve(__dirname,'..'),base='/text-adventure-play';
const config:NextConfig={output:'export',basePath:base,trailingSlash:true,poweredByHeader:false,devIndicators:false,images:{unoptimized:true},
  env:{NEXT_PUBLIC_STATIC_PAGES:'true',NEXT_PUBLIC_BASE_PATH:base},
  webpack(config,{webpack}){
    config.resolve.alias={...config.resolve.alias,'@/server/service$':path.join(root,'src/browser/service.ts'),'better-sqlite3$':path.join(root,'src/browser/sqlite.ts')};
    config.resolve.fallback={...config.resolve.fallback,fs:false,path:false,crypto:false};
    config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:(crypto|fs|path|os)$/,(resource:{context:string;request:string})=>{
      if(resource.context.startsWith(path.join(root,'src')))resource.request=path.join(root,'src/browser',resource.request.slice(5)+'.ts');
    }));
    config.plugins.push(new webpack.ProvidePlugin({Buffer:['buffer','Buffer'],process:[path.join(root,'src/browser/process.ts'),'default']}));
    return config;
  },
};
export default config;
