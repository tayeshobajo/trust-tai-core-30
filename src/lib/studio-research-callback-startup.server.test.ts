import {it,expect,vi} from "vitest";
import {generateKeyPairSync} from "node:crypto";
import {loadCallbackStartup,CALLBACK_CONFIG_LABEL,CALLBACK_PRIVATE_KEY_LABEL} from "./studio-research-callback-startup.server";
import {TRIAL_POLICY_SHA256} from "./studio-research-trial.server";
import {STUDIO_TRIAL_REQUEST_ID,STUDIO_TRIAL_SOURCE} from "../domain/studio-research-trial";
function fixture(){
 const keys=Array.from({length:3},()=>generateKeyPairSync("ed25519"));
 const pub=(i:number)=>keys[i]!.publicKey.export({type:"spki",format:"pem"}).toString();
 const config={version:1,enabled:true,trial:{policyDigest:TRIAL_POLICY_SHA256,requestId:STUDIO_TRIAL_REQUEST_ID,source:STUDIO_TRIAL_SOURCE,subjectId:"11111111-1111-4111-8111-111111111111",notBefore:1000,expiresAt:61000},studioPublicKeyPem:pub(1),hostPublicKeyPem:pub(2)};
 const env:Record<string,string>={[CALLBACK_CONFIG_LABEL]:JSON.stringify(config),[CALLBACK_PRIVATE_KEY_LABEL]:keys[0]!.privateKey.export({type:"pkcs8",format:"pem"}).toString(),SUPABASE_SERVICE_ROLE_KEY:"dummy-only"};
 return {config,env,pub};
}
it("invalid config/trust fails before privileged credential read or assembly",()=>{
 for(const mode of ["missing","disabled","unknown","trial","private","reuse","malformed"]){
 const f=fixture();
 if(mode==="missing")delete f.env[CALLBACK_CONFIG_LABEL];
 if(mode==="disabled")f.config.enabled=false;
 if(mode==="unknown")(f.config as any).extra=true;
 if(mode==="trial")f.config.trial.expiresAt=1000;
 if(mode==="private")f.env[CALLBACK_PRIVATE_KEY_LABEL]="invalid";
 if(mode==="reuse")f.config.hostPublicKeyPem=f.pub(1);
 if(!["missing","malformed"].includes(mode))f.env[CALLBACK_CONFIG_LABEL]=JSON.stringify(f.config);
 if(mode==="malformed")f.env[CALLBACK_CONFIG_LABEL]="{";
 const get=vi.fn((k:string)=>f.env[k]),fetcher=vi.fn(),assemble=vi.fn();
 expect(loadCallbackStartup(get,fetcher,()=>2000,assemble)).toBeUndefined();
 expect(assemble).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 expect(get.mock.calls.flat()).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
 }
});
it("missing platform credential fails closed and valid dependencies do not fetch during startup",()=>{
 const f=fixture(),fetcher=vi.fn();delete f.env["SUPABASE_SERVICE_ROLE_KEY"];
 expect(loadCallbackStartup(k=>f.env[k],fetcher)).toBeUndefined();
 f.env["SUPABASE_SERVICE_ROLE_KEY"]="dummy-only";
 expect(loadCallbackStartup(k=>f.env[k],fetcher,()=>2000)).toBeTypeOf("function");expect(fetcher).not.toHaveBeenCalled();
});
it("rejects callback identity reuse and private material in public configuration",()=>{
 for(const mode of ["callback-reuse","private-as-public"]){
  const f=fixture();f.config.studioPublicKeyPem=mode==="callback-reuse"?f.pub(0):f.env[CALLBACK_PRIVATE_KEY_LABEL]!;
  f.env[CALLBACK_CONFIG_LABEL]=JSON.stringify(f.config);
  const get=vi.fn((k:string)=>f.env[k]),assemble=vi.fn();
  expect(loadCallbackStartup(get,vi.fn(),()=>2000,assemble)).toBeUndefined();
  expect(get.mock.calls.flat()).not.toContain("SUPABASE_SERVICE_ROLE_KEY");expect(assemble).not.toHaveBeenCalled();
 }
});
