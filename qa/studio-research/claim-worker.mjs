// Synthetic multi-process persistence test; never used by the plugin worker.
import {createInterface} from 'node:readline';
import {CoordinatorStore} from '../../packages/studio-research-coordinator/dist/store.js';
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
const {path,id}=JSON.parse((await lines.next()).value);
const store=new CoordinatorStore(path), job=store.read(id);
process.stdout.write('ready\n');
await lines.next();
try{const result=store.transition(job,'collecting',{});process.stdout.write(result?'claimed\n':'lost\n');}catch{process.stdout.write('lost\n');}finally{store.close();process.exit(0);}
