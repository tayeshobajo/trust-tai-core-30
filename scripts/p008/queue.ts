import { createClient } from "@supabase/supabase-js";
import { assertItemTransition } from "../../src/domain/content";
const ORG="ee683a64-e045-4226-a8ff-4ae6590d6789", ITEM="citm_da7jlq4nmtn2yer2";
const c = createClient(process.env.TRUST_TAI_SUPABASE_URL!, process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!, {auth:{persistSession:false}});
async function get(){const {data,error}=await c.from("content_items").select("*").eq("organization_id",ORG).eq("id",ITEM).maybeSingle(); if(error)throw error; return data as any;}
async function move(to:string){const cur=await get(); if(cur.state===to){console.log("already",to);return;} assertItemTransition(cur.state,to as any);
 const {error}=await c.from("content_items").update({state:to,updated_at:new Date().toISOString()}).eq("organization_id",ORG).eq("id",ITEM); if(error)throw error; console.log(cur.state,"->",to);}
await move("approved");
await move("queued");
console.log(JSON.stringify(await get().then(i=>({state:i.state,publish_key:i.publish_key}))));
