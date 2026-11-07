import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
const result=await build({entryPoints:['src/lib/studio-research-studio-assembly.server.ts','src/lib/studio-research-app.server.ts'],bundle:true,platform:'browser',format:'esm',write:false,outdir:'/tmp/studio-cloudflare-audit-unused',metafile:true,external:['node:crypto'],logLevel:'silent'});
const imports=Object.values(result.metafile.outputs).flatMap(x=>x.imports.filter(i=>i.external).map(i=>i.path));
if(imports.some(x=>x!=='node:crypto'))throw Error('unexpected external import: '+JSON.stringify(imports));
const inputs=Object.keys(result.metafile.inputs);
if(inputs.some(x=>/route-ledger-node|coordinator-store|opencode-executor|public-source\.server/.test(x)))throw Error('host-only module reached');
writeFileSync('/tmp/studio-cloudflare-import-audit.json',JSON.stringify({entries:2,inputs:inputs.length,externals:[...new Set(imports)],hostOnlyImports:[]},null,2));
console.log(JSON.stringify({entries:2,inputs:inputs.length,externals:[...new Set(imports)],hostOnlyImports:[]}));
