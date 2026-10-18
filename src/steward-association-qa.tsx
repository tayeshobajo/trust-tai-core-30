import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createRootRoute,createRouter,RouterProvider,createMemoryHistory} from '@tanstack/react-router';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '@/components/tt/app-shell';
import {WorkroomView,WorkroomMoreMenu} from '@/components/tt/steward/workroom-view';
import {TaskEditor} from '@/components/tt/steward/business-task-board';
import {TTButton} from '@/components/tt/primitives';
import {buildWorkroom,receiptKey} from '@/domain/steward-workroom';
import {appendLinkedBusinessWork,withMeetingAssociation} from '@/domain/steward-meeting-links';
import type {WorkspaceIdentity} from '@/lib/workspace';
import type {BoardTask} from '@/domain/cmd-tasks';
import type {Commitment} from '@/domain/steward';
import '@/styles.css';
const id='00000000-0000-4000-8000-000000000011';
// Empty organization ID disables the real AppShell presence hook. No auth state is provided or changed.
const identity:WorkspaceIdentity={organizationId:'',userId:'fictional',name:'Fictional reviewer',email:'review@example.invalid',firstName:'Fictional',organizationName:'Fictional QA — no live data',organizationSlug:'fictional',avatarUrl:null,role:'member',canManage:false,apps:['home','clients','scout','comms','roadmap','website','ops','studio','pulse','conductor','approvals','steward'].map(appId=>({appId,level:'work',visible:true,canWork:true,canManage:false,because:'fictional'}))};
const commitments:Commitment[]=Array.from({length:7},(_,index)=>({id:index===0?id:`fictional-commitment-${index}`,organizationId:'',conversationId:id,what:index===0?'Confirmed meeting promise — distinct original ID':'Fictional agreed deliverable '+(index+1),ownerName:'Fictional teammate',ownerUserId:'fictional',status:index<2?'kept':'open',sourceKey:'fictional',evidence:[{kind:'human',label:'Fictional source quote'}],createdAt:'',updatedAt:''} as Commitment));
const receiptMap=new Map(commitments.slice(0,2).map(c=>[receiptKey(c.id),{taskKey:receiptKey(c.id),completedAt:'2026-10-18T01:00:00Z',completedBy:'Fictional reviewer',completionNote:'Fictional checked result only.'}]));
const task:BoardTask={id,organization_id:'',task_visibility:'business',title:'Linked canonical business task — later email refinements remain email-sourced',status:'open',owner_user_id:'fictional',owner_label:'Fictional reviewer',created_by:'fictional',next_action:'Review the latest email refinement with the teammate.',blocked_because:'',depends_on_task_id:null,parent_task_id:null,completion_evidence:'Fictional original board evidence, not a commitment receipt.',completed_at:null,completed_by:null,archived_at:null,due_at:null,updated_at:'2026-10-18T01:00:00Z',revision:2,acceptance_criteria:['Keep original source and review evidence'],context_links:withMeetingAssociation([{label:'Email refinement (fictional)',url:'https://example.invalid/email',kind:'email'}],id),notes:'Fictional retained task notes.',correlation_id:null};
function Fixture(){
 const [edited,setEdited]=useState(false);const [row,setRow]=useState(task);const [saved,setSaved]=useState(false);
 const mode=new URLSearchParams(window.location.search).get('state')??'ready';
 const base=buildWorkroom([{id,title:'Fictional meeting — weekly delivery and review',provider:'fathom',sourceUrl:'',occurredAt:'2026-10-18T01:00:00Z',participantCount:3,segmentCount:12,lastSegmentAt:'00:12:00',coverageConfirmed:false}],mode==='empty'?[]:commitments,receiptMap,new Map([[id,1]]));
 const projected=appendLinkedBusinessWork(base,mode==='ready'||mode==='truncated'?[row]:[],'');
 return <AppShell identity={identity} canvas="workroom"><div className="border-b border-border p-2 text-xs text-muted-foreground">Fictional shared-component QA · no live reads/writes · {saved?'Association saved locally.':''}<TTButton variant="quiet" className="ml-2 h-7 text-xs" onClick={()=>setEdited(true)}>Edit fictional existing task</TTButton></div><WorkroomView embedded meetings={projected} commitmentFor={key=>commitments.find(c=>c.id===key)} receiptsFailed={false} linkedRead={{state:mode==='loading'?'loading':mode==='error'?'error':'ready',truncated:mode==='truncated'}} sync={{running:false,failure:null,lastSuccessAt:null,added:0,refreshed:0,unchanged:0,preserved:0,warnings:[],pendingTranscript:0,hasMore:false,onRetry:()=>{}}} headerMenu={<WorkroomMoreMenu><a href="#fictional">All outstanding work</a></WorkroomMoreMenu>} accountSlot={null}/>{edited?<TaskEditor task={row} scope="business" identity={identity} tasks={[row]} people={[]} meetingOptions={[{id,title:'Fictional meeting — weekly delivery and review'}]} onClose={()=>setEdited(false)} onSave={async input=>{setRow({...row,...input,revision:row.revision+1});setSaved(true);setEdited(false);}}/>:null}</AppShell>;
}
const rootRoute=createRootRoute({component:Fixture});
const router=createRouter({routeTree:rootRoute,history:createMemoryHistory({initialEntries:['/']})});
const root=document.getElementById('root');if(root)createRoot(root).render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router}/></QueryClientProvider>);
