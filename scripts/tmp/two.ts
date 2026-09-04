import { callRoadmapProvider, extractJsonObject } from "../../src/lib/roadmap-research.server";
const mod = await import("../../src/lib/content-engine.server");
const src = await Bun.file("src/lib/content-engine.server.ts").text();
const m = src.match(/const POST_INSTRUCTIONS = \[([\s\S]*?)\]\.join\("\\n"\);/);
const POST = m![1]!.split("\n").map(l=>l.trim().replace(/^"|",?$/g,"")).filter(Boolean).join("\n");
const pages = [{path:"/insights",title:"Insights"},{path:"/what-we-build",title:"What We Build"}];
const { raw } = await callRoadmapProvider(POST, JSON.stringify({
  respond_with: "json",
  keyword: "business operating roadmap for founder-led businesses",
  cluster: ["diagnosis","sequence","handover"],
  search_intent: "understand how to build an operating roadmap",
  audience_problem: "the business depends on the founder",
  post: { slug: "sequence-before-scale", title: "Sequence before scale", angle: "order of work", reader_job: "know what to do first", outline: ["a","b","c","d"] },
  known_paths: pages,
}), { webSearch: false });
console.log("len", raw.length);
try { const p = extractJsonObject(raw) as any; console.log(Object.keys(p), "draft:", String(p.draft_markdown ?? "").length); }
catch (e) { console.log("parse fail", (e as Error).message, raw.slice(0,300), "TAIL", raw.slice(-300)); }
void mod;
