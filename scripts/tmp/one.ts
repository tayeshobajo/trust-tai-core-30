import { callRoadmapProvider } from "../../src/lib/roadmap-research.server";
const { raw, provider, model } = await callRoadmapProvider(
  "You write one blog post for Trust Tai and return json only. Keys: draft_markdown (markdown, 700-1200 words), hit_rationale, seo_title, meta_description, slug, internal_links, cta, category, tags, image_brief, alt_text, must_cover.",
  JSON.stringify({ respond_with: "json", post: { title: "Sequence before scale", outline: ["a","b","c"] } }),
  { webSearch: false },
);
console.log(provider, model, raw.length);
console.log(raw.slice(0, 400));
console.log("...TAIL...", raw.slice(-300));
