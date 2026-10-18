import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createRootRoute,createRouter,RouterProvider,createMemoryHistory} from '@tanstack/react-router';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppShell} from '@/components/tt/app-shell';
import {WorkroomView} from '@/components/tt/steward/workroom-view';
import {buildWorkroom,receiptKey} from '@/domain/steward-workroom';
import {appendLinkedBusinessWork,withMeetingAssociation} from '@/domain/steward-meeting-links';
import {requiredWorkKey} from '@/domain/steward-required-work';
import type {WorkspaceIdentity} from '@/lib/workspace';
import type {BoardTask} from '@/domain/cmd-tasks';
import type {Commitment} from '@/domain/steward';
import '@/styles.css';
const id='00000000-0000-4000-8000-000000000011';
const identity:WorkspaceIdentity={organizationId:'',userId:id,name:'Fictional reviewer',email:'review@example.invalid',firstName:'Fictional',organizationName:'Fictional QA',organizationSlug:'fictional',avatarUrl:null,role:'member',canManage:false,apps:['home','steward','scout'].map(appId=>({appId,level:'work',visible:true,canWork:true,canManage:false,because:'fictional'}))};
const c:Commitment={id,organizationId:id,conversationId:id,what:'Fictional verified transcript commitment',ownerName:'Fictional reviewer',ownerUserId:id,status:'kept',sourceKey:'fictional',evidence:[],createdAt:'',updatedAt:''};
const receipts=new Map([[receiptKey(id),{taskKey:receiptKey(id),completedAt:'2026-10-18T01:00:00Z',completionNote:'Fictional checked result only.'}]]);
const base=buildWorkroom([{id,title:'Fictional meeting — required work review',provider:'fathom',sourceUrl:'',occurredAt:'2026-10-18T01:00:00Z',participantCount:3,segmentCount:12,lastSegmentAt:'00:12:00',coverageConfirmed:true}],[c],receipts,new Map([[id,0]]));
const titles=[
 'Fictional Dental — Meeting follow-up: Confirm the newsletter audience and consent review before preparing the campaign draft',
 'Fictional Dental — Meeting follow-up: Revise the patient welcome email and collect clinical approval for the updated wording',
 'Fictional Dental — Meeting follow-up: Reconcile the campaign reporting dates and document which results remain unavailable',
 'Fictional Dental — Meeting follow-up: Review the intake form handoff and identify the next owner for unresolved dependencies',
 'Fictional Dental — Meeting follow-up: Prepare the social content calendar for team review without scheduling or publishing',
 'Fictional Dental — Meeting follow-up: Check the client file inventory and flag missing source materials for manual review',
];
const tasks:BoardTask[]=titles.map((title,i)=>({id:`00000000-0000-4000-8000-${String(i+30).padStart(12,'0')}`,organization_id:id,task_visibility:'business',title,status:'open',owner_user_id:id,owner_label:'Fictional reviewer',created_by:id,next_action:'Review only',blocked_because:'',depends_on_task_id:null,parent_task_id:null,completion_evidence:'',completed_at:null,completed_by:null,archived_at:null,due_at:null,updated_at:'2026-10-18T01:00:00Z',revision:0,acceptance_criteria:[],context_links:withMeetingAssociation([],id),notes:null,correlation_id:i===5?requiredWorkKey(id,id):null}));
function Fixture(){return <AppShell identity={identity} canvas="workroom"><p className="border-b border-border p-2 text-xs text-muted-foreground">Fictional title QA · no live reads or writes</p><WorkroomView embedded meetings={appendLinkedBusinessWork(base,tasks,id)} commitmentFor={()=>c} receiptsFailed={false} linkedRead={{state:'ready',truncated:false}} sync={{running:false,failure:null,lastSuccessAt:null,added:0,refreshed:0,unchanged:0,preserved:0,warnings:[],pendingTranscript:0,hasMore:false,onRetry:()=>{}}} headerMenu={null} accountSlot={null}/></AppShell>;}
const rootRoute=createRootRoute({component:Fixture});const router=createRouter({routeTree:rootRoute,history:createMemoryHistory({initialEntries:['/']})});const root=document.getElementById('root');if(root)createRoot(root).render(<QueryClientProvider client={new QueryClient()}><RouterProvider router={router}/></QueryClientProvider>);
