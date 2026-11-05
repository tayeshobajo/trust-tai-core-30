import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const { Miniflare } = createRequire(resolve(process.argv[2] || '/tmp/rfp-workers-probe', 'package.json'))('miniflare');
const mf=new Miniflare({modules:true,compatibilityDate:'2026-07-30',compatibilityFlags:['nodejs_compat'],script:`
import {resolve4} from 'node:dns/promises';
import {connect} from 'cloudflare:sockets';
export default {async fetch(){
 let socket;
 try{
 const hostname='example.com'; const addresses=await resolve4(hostname);
 socket=connect({hostname:addresses[0],port:443},{secureTransport:'starttls'});
 await socket.opened;
 socket=socket.startTls({expectedServerHostname:hostname});
 await socket.opened;
 const timer=setTimeout(()=>socket.close(),10000);
 const writer=socket.writable.getWriter();
 await writer.write(new TextEncoder().encode('GET / HTTP/1.1\\r\\nHost: '+hostname+'\\r\\nConnection: close\\r\\n\\r\\n'));
 const reader=socket.readable.getReader(); const {value}=await reader.read();
 clearTimeout(timer);await socket.close();
 return Response.json({status:new TextDecoder().decode(value).split('\\r\\n')[0]});
 }catch(e){if(socket)await socket.close().catch(()=>{});return Response.json({error:e.message},{status:500});}
}};`});
try{const r=await mf.dispatchFetch('http://localhost');console.log(r.status,await r.text());}finally{await mf.dispose();}
