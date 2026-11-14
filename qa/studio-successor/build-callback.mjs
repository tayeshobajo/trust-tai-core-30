import {build} from '../../node_modules/esbuild/lib/main.js';
import fs from 'node:fs';
const out='qa/studio-successor/callback';fs.mkdirSync(out,{recursive:true});
const r=await build({entryPoints:['src/lib/studio-research-callback-startup.server.ts'],bundle:true,format:'esm',platform:'neutral',target:'es2022',mainFields:['module','main'],conditions:['import','default'],external:['node:*'],banner:{js:'import { Buffer } from "node:buffer";'},outfile:out+'/callback-startup.mjs',metafile:true});
for(const x of r.metafile.outputs[out+'/callback-startup.mjs'].imports)if(!['node:crypto','node:buffer'].includes(x.path))throw Error('Unexpected callback dependency');
if(Object.keys(r.metafile.inputs).some(p=>/coordinator-store.server|linux-runtime|node:sqlite|child_process/.test(p)))throw Error('Host code in callback');
fs.writeFileSync(out+'/index.ts',`import { loadCallbackStartup } from "./callback-startup.mjs";\nDeno.serve(async (request: Request) => { const handler = loadCallbackStartup(label => Deno.env.get(label),fetch); if (!handler) return Response.json({error:"callback_unavailable"},{status:503,headers:{"Cache-Control":"no-store"}}); return handler(request); });\n`);
fs.writeFileSync(out+'/deno.json','{"nodeModulesDir":"auto","compilerOptions":{"lib":["deno.window","dom","esnext"]}}\n');
fs.writeFileSync(out+'/import-audit.json',JSON.stringify(r.metafile,null,2));
