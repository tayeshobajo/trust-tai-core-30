import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, createRootRoute, createRoute, RouterProvider, Outlet, Link, useRouterState } from '@tanstack/react-router';
import { AppShell } from './components/tt/app-shell';
import { WorkroomView, WorkroomMoreMenu } from './components/tt/steward/workroom-view';
import { APP_REGISTRY } from './domain/registry';
import type { WorkspaceIdentity } from './lib/workspace';
import type { WorkroomMeeting } from './domain/steward-workroom';
import './styles.css';
// Temporary fictional-only entry. Empty identity prevents presence writes; no data services mounted.
const identity: WorkspaceIdentity = { userId:'', organizationId:'', email:'review@example.invalid', name:'Fictional reviewer', firstName:'Fictional', organizationName:'FICTIONAL QA', organizationSlug:'fictional', role:'member', canManage:false, avatarUrl:null, apps:APP_REGISTRY.map(a=>({appId:a.id,level:'work',visible:true,canWork:true,canManage:false,because:'fictional'})) };
const meetings: WorkroomMeeting[] = [1,2].map(n=>({id:`fictional-meeting-${n}`,title:n===1?'Fictional launch review — long meeting title for navigation and layout checks':'Fictional website discovery',occurredAt:'2026-10-17T12:00:00Z',provider:'fathom',sourceUrl:'',participantCount:3,segmentCount:40,lastSegmentAt:'35:00',coverage:'unknown',openProposals:1,agreed:12,done:3,needsVerification:0,score:25,remark:'Fictional review: remaining promises need completion evidence.', rows:Array.from({length:12},(_,i)=>({id:`fictional-${n}-${i}`,what:i===0?'Approve the fictional launch page copy with a long descriptive title':`Fictional deliverable ${i+1}`,owner:{label:i%2?'Morgan (fictional)':'Alex (fictional)',verified:true},due:{label:'2026-10-20',exact:true},status:i>8?'kept':'open',kept:i>8,verified:i>8,receipt:i>8?{taskKey:`fictional-${i}`,completedAt:'2026-10-17T12:00:00Z',completedBy:'Alex (fictional)',completionNote:'Fictional reviewed evidence only.'}:null,evidenceCount:0,sourceKey:`fictional-${i}`}))}));
const sync={running:false,failure:null,lastSuccessAt:'2026-10-18T01:00:00Z',added:0,refreshed:0,unchanged:2,preserved:0,warnings:[],pendingTranscript:0,hasMore:false,onRetry:()=>{}};
function Page(){ const path=useRouterState({select:s=>s.location.pathname}); const mode=new URLSearchParams(window.location.search).get('state'); return <AppShell identity={identity} canvas={path.includes('steward')?'workroom':'default'}>{path.includes('steward') ? mode==='loading'?<p className="p-6">Reading stored meetings… (fictional)</p>:mode==='error'?<p className="p-6 text-destructive">Couldn’t read stored meetings. Fictional error.</p>:<WorkroomView embedded meetings={mode==='empty'?[]:meetings} commitmentFor={()=>undefined} receiptsFailed={false} sync={sync} headerMenu={<WorkroomMoreMenu><Link to="/modules/$slug" params={{slug:'steward/tasks'}}>All outstanding work</Link></WorkroomMoreMenu>} accountSlot={null}/> : <h1 className="text-2xl">{path==='/'?'Home':'Scout'} · fictional navigation QA</h1>}</AppShell> }
const root=createRootRoute({component:()=> <QueryClientProvider client={new QueryClient()}><Outlet/></QueryClientProvider>});
const home=createRoute({getParentRoute:()=>root,path:'/',component:Page});
const module=createRoute({getParentRoute:()=>root,path:'/modules/$slug',component:Page});
const router=createRouter({routeTree:root.addChildren([home,module])});
const el=document.getElementById('root'); if(el) createRoot(el).render(<RouterProvider router={router}/>);
