import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const { Miniflare } = createRequire(resolve(process.argv[2] || '/tmp/rfp-workers-probe', 'package.json'))('miniflare');
const mf = new Miniflare({ modules: true, compatibilityDate:'2026-07-30', compatibilityFlags:['nodejs_compat'], script: `
import { resolve4 } from 'node:dns/promises';
import { connect } from 'node:tls';
export default { async fetch() {
 const hostname='pathwaylending.org';
 try {
 const addresses=await resolve4(hostname);
 const result=await new Promise((resolve,reject)=>{
  const socket=connect({host:addresses[0],port:443,servername:hostname,rejectUnauthorized:true},()=>{
   socket.write('GET /neighborhood-growth-grants/ HTTP/1.1\\r\\nHost: '+hostname+'\\r\\nConnection: close\\r\\nAccept-Encoding: identity\\r\\n\\r\\n');
  });
  const timer=setTimeout(()=>socket.destroy(new Error('timeout')),10000);
  socket.on('data',b=>{clearTimeout(timer);resolve({status:b.toString().split('\\r\\n')[0],authorized:socket.authorized});socket.destroy();});
  socket.on('error',e=>{clearTimeout(timer);reject(e);});
 });
 return Response.json({addresses,result});
 } catch(e) {return Response.json({error:e.message},{status:500});}
}};` });
try { const response=await mf.dispatchFetch('http://localhost'); console.log(response.status,await response.text()); } finally {await mf.dispose();}
