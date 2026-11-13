// @vitest-environment jsdom
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
const h=vi.hoisted(()=>({send:vi.fn()}));
vi.mock("@tanstack/react-start",()=>({useServerFn:(fn:unknown)=>fn}));
vi.mock("@/data/studio-attempt.functions",()=>({studioAttemptAction:h.send}));
import {ApprovedFollowup} from "./approved-followup";
import {STUDIO_APPROVED_FOLLOWUP as ids} from "@/domain/studio-approved-followup";
afterEach(()=>{cleanup();h.send.mockReset();});
it("requires verified approval, starts only once, and renders the returned persisted brief",async()=>{
 const base={version:2,requestId:ids.requestId,attemptId:ids.attemptId,priorRunId:"3bd276dc-0500-40a3-81ea-b903c0c185ca",status:"approved",callbackStatus:"approved",receiptCount:0,phase:null,stopEvidence:"not_attempted",providerRequests:null,duplicateCostPossible:true};
 h.send.mockImplementation(async({data})=>({status:"ok",view:data.operation==="start"?{...base,status:"ready",callbackStatus:"ready",brief:{research:{version:1,requestId:ids.requestId,topics:[],limitations:["Validated IANA test result"]},people:[],draft:null}}:base}));
 render(<ApprovedFollowup organizationId={ids.organizationId}/>);
 const start=screen.getByRole("button",{name:"Run approved follow-up once"}) as HTMLButtonElement;
 expect(start.disabled).toBe(true);fireEvent.click(screen.getByRole("button",{name:"Check follow-up status"}));
 await screen.findByText(/Attempt status: approved/);expect(start.disabled).toBe(false);
 fireEvent.click(start);await screen.findByText("Validated IANA test result");expect(start.disabled).toBe(true);
 expect(h.send.mock.calls.filter(c=>c[0].data.operation==="start")).toHaveLength(1);
});
