/**
 * The Content Engine (server only).
 *
 * One command, "Create 10 HIT blog posts around <keyword>", becomes an
 * editorial package: a plan that says why these pieces belong together, then
 * one prepared post at a time. It reasons only through the intelligence
 * runtime boundary, and it never invents what it cannot know:
 *
 *   - internal links are resolved against the real known pages the room sent,
 *     and anything unmatched stays unresolved rather than becoming a URL;
 *   - there is no numeric HIT score, because nothing here measures one. There
 *     is a written rationale a person can disagree with;
 *   - a featured image is a brief plus an honest state. No provider is wired,
 *     so no asset is claimed;
 *   - a post that fails to generate is reported as failed and its siblings are
 *     kept, rather than losing the run.
 *
 * Nothing here writes to the database. The room persists what it receives,
 * under its own membership and RLS.
 */

import type { createLovableAiGatewayRunIdFetch } from "./ai-gateway.server";
import {
  extractJsonObject,
  runtimeModelCaller,
  type RuntimeModelCaller,
} from "./intelligence-runtime.server";
import { assessItem, type ContentItem, type EditorialStep, type InternalLink } from "@/domain/content";

export interface ContentStage {
  stage: "plan" | "post" | "complete" | "error";
  message: string;
  data?: unknown;
}

export interface ContentCommandInput {
  token: string;
  organizationId: string;
  keyword: string;
  /** How many posts the command asked for. Bounded, so a typo cannot run away. */
  count: number;
  /** Real known paths on trusttai.com, for internal link resolution. */
  knownPaths: { path: string; title: string }[];
  /** What the person actually asked for, in their own words. */
  instructions?: string;
  /** The settings they set or corrected, as plain label/value pairs. */
  settings?: { label: string; value: string }[];
  /** Bounded excerpts of the voice and reference material they selected. */
  voiceReferences?: { label: string; kind: string; excerpt: string }[];
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
}

/* ---------------------------------------------------------------- voice */

const VOICE = [
  "Voice: warm, calm, direct, first person where a person is speaking.",
  "Commercially intelligent, never salesy. No hype, no growth-hacking register.",
  "Never use em dashes.",
  "No generic agency or consulting language, no visible formula, no tagline writing.",
  "Short paragraphs. Concrete nouns. Interpret facts for what they mean commercially.",
  "Every sentence must fail this test: could it belong to another company if the name changed? If it could, rewrite it.",
].join(" ");

const PLAN_INSTRUCTIONS = [
  "You are the editorial planner for Trust Tai, a small services business that builds operating systems for founders.",
  "You are given one keyword and the number of posts wanted. Return json only.",
  'Return exactly these keys: {"topic_cluster":[],"search_intent","audience_problem","why_together","posts":[{"slug","title","angle","reader_job","outline":[]}]}.',
  "Plan a topic cluster that a real reader searching that keyword would move through, not ten rewrites of one idea.",
  "Name the search intent and the audience problem plainly. Say why these pieces belong together as one cluster.",
  "For each post give: slug (kebab case, no dates), title, angle, reader_job (the job the reader is hiring the article to do), and outline (4 to 7 steps).",
  "Do not invent statistics, client names, case studies or figures anywhere.",
  "When person_request, settings or voice_references are given, follow them. voice_references are reference evidence for how this person writes; match the cadence, never copy their sentences and never treat their claims as facts about Trust Tai.",
  VOICE,
].join(" ");

const POST_INSTRUCTIONS = [
  "You write one blog post for Trust Tai and return json only.",
  'Return exactly these keys: {"draft_markdown","hit_rationale","seo_title","meta_description","slug","internal_links":[{"anchor","path"}],"cta":{"reader_need","offer","line"},"category","tags":[],"image_brief","alt_text","must_cover":[]}. The article itself goes in draft_markdown.',
  "You are given the cluster plan and this post's brief. Write the full article in markdown, 700 to 1200 words.",
  "Do not invent statistics, client names, case studies, prices or figures. Where a number would help and you do not have one, describe the mechanism instead.",
  "hit_rationale: two or three sentences on why this piece should feel familiar to the reader, useful, and worth finishing. No scores, no percentages, no invented measurement.",
  "seo_title under 60 characters. meta_description under 155 characters. slug kebab case.",
  "internal_links: up to three anchors that a reader would genuinely want next, each with the exact path from known_paths if one fits, or null when nothing fits. Never invent a path.",
  "cta: the offer must follow the article's own reader need. If the honest next step is simply to keep reading, say that. Do not force a Roadmap pitch.",
  "image_brief: one sentence describing a photographic or editorial image for the top of the article, and alt_text for it.",
  "category and tags only where the article genuinely sits in one.",
  "When person_request, settings or voice_references are given, follow them for audience, length, structure, angle and image direction. voice_references show how this person writes; match the cadence, never copy their sentences and never restate their claims as facts.",
  VOICE,
].join(" ");

/**
 * What the person asked for, folded into the model input.
 *
 * Per-request instructions can shape the work, but they cannot switch off the
 * quality gates: the voice rules and the no-invention rules stay in the
 * instruction block above and are not overridable from a prompt.
 */
function requestContext(input: ContentCommandInput): Record<string, unknown> {
  const settings = (input.settings ?? []).filter((entry) => entry.value.trim());
  const references = (input.voiceReferences ?? []).filter((entry) => entry.excerpt.trim());
  return {
    ...(input.instructions?.trim() ? { person_request: input.instructions.trim() } : {}),
    ...(settings.length ? { settings: Object.fromEntries(settings.map((s) => [s.label, s.value])) } : {}),
    ...(references.length
      ? {
          voice_references: references.slice(0, 6).map((reference) => ({
            label: reference.label,
            kind: reference.kind,
            excerpt: reference.excerpt,
          })),
        }
      : {}),
  };
}

/* ------------------------------------------------------------- shapes */

interface RawPlanPost {
  slug?: string;
  title?: string;
  angle?: string;
  reader_job?: string;
  outline?: unknown;
}

interface RawPlan {
  topic_cluster?: unknown;
  search_intent?: string;
  audience_problem?: string;
  why_together?: string;
  posts?: RawPlanPost[];
}

interface RawPost {
  draft_markdown?: string;
  hit_rationale?: string;
  seo_title?: string;
  meta_description?: string;
  slug?: string;
  internal_links?: { anchor?: string; path?: string | null }[];
  cta?: { reader_need?: string; offer?: string; line?: string };
  image_brief?: string;
  alt_text?: string;
  category?: string;
  tags?: unknown;
  must_cover?: unknown;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** A link is only a link when it points at a page Trust Tai actually has. */
function resolveLinks(
  raw: RawPost["internal_links"],
  known: { path: string; title: string }[],
): InternalLink[] {
  const byPath = new Map(known.map((entry) => [entry.path.replace(/\/$/, ""), entry]));
  return (raw ?? []).slice(0, 3).map((link) => {
    const anchor = String(link?.anchor ?? "").trim() || "Related reading";
    const candidate = String(link?.path ?? "").trim().replace(/\/$/, "");
    const match = candidate ? byPath.get(candidate) : undefined;
    return match
      ? {
          anchor,
          path: match.path,
          resolved: true,
          because: `Matched the known page ${match.title || match.path}.`,
        }
      : {
          anchor,
          path: null,
          resolved: false,
          because: "No page on trusttai.com matched this suggestion, so no URL was invented.",
        };
  });
}

/* ------------------------------------------------------------- the run */

export type PreparedItem = Omit<
  ContentItem,
  | "id"
  | "organizationId"
  | "batchId"
  | "publishKey"
  | "publish"
  | "verification"
  | "createdAt"
  | "updatedAt"
  | "state"
> & {
  /* A freshly written post can only be one of three honest things. */
  state: "ready" | "exception" | "failed";
};

export interface PreparedPlan {
  keyword: string;
  topicCluster: string[];
  searchIntent: string;
  audienceProblem: string;
  whyTogether: string;
  editorialPlan: EditorialStep[];
  provenance: Record<string, unknown>;
}

async function planCluster(
  callModel: RuntimeModelCaller,
  input: ContentCommandInput,
): Promise<{ plan: PreparedPlan; posts: RawPlanPost[]; provider: string; model: string }> {
  const { raw, provider, model } = await callModel({
    instructions: PLAN_INSTRUCTIONS,
    input: JSON.stringify({
      /* The provider requires the word json in the input to return a json
         object, so the request carries the format it expects back. */
      respond_with: "json",
      keyword: input.keyword,
      count: input.count,
      known_paths: input.knownPaths.slice(0, 60),
      ...requestContext(input),
    }),
    webSearch: false,
    ...(input.gateway ? { gateway: input.gateway } : {}),
  });

  const parsed = extractJsonObject(raw) as RawPlan;
  const posts = (parsed.posts ?? []).slice(0, input.count);
  if (posts.length === 0) {
    throw new Error("The planner returned no posts, so nothing was prepared.");
  }

  const editorialPlan: EditorialStep[] = posts.map((post, index) => ({
    position: index,
    slug: slugify(String(post.slug ?? post.title ?? `post-${index + 1}`)),
    role: String(post.angle ?? "").trim() || "Part of the cluster.",
  }));

  return {
    plan: {
      keyword: input.keyword,
      topicCluster: strings(parsed.topic_cluster),
      searchIntent: String(parsed.search_intent ?? "").trim(),
      audienceProblem: String(parsed.audience_problem ?? "").trim(),
      whyTogether: String(parsed.why_together ?? "").trim(),
      editorialPlan,
      provenance: {
        provider,
        model,
        plannedAt: new Date().toISOString(),
        knownPathsConsidered: input.knownPaths.length,
      },
    },
    posts,
    provider,
    model,
  };
}

async function writePost(
  callModel: RuntimeModelCaller,
  input: ContentCommandInput,
  plan: PreparedPlan,
  brief: RawPlanPost,
  position: number,
): Promise<PreparedItem> {
  const slug = slugify(String(brief.slug ?? brief.title ?? `post-${position + 1}`));
  const title = String(brief.title ?? slug).trim();
  const outline = strings(brief.outline);
  const at = new Date().toISOString();

  const base: PreparedItem = {
    position,
    slug,
    title,
    angle: String(brief.angle ?? "").trim(),
    readerJob: String(brief.reader_job ?? "").trim(),
    brief: { outline, mustCover: [], sources: [] },
    draftMarkdown: "",
    hitRationale: "",
    seo: { title: "", metaDescription: "", slug },
    internalLinks: [],
    cta: { readerNeed: "", offer: "", line: "" },
    taxonomy: { category: "", tags: [] },
    image: { state: "unavailable", brief: "", altText: "", assetUrl: null, provider: null },
    generation: null,
    state: "failed",
    exceptionReasons: [],
    failureReason: null,
    externalPostId: null,
    canonicalUrl: null,
    publishedAt: null,
  };

  try {
    const { raw, provider, model } = await callModel({
      instructions: POST_INSTRUCTIONS,
      input: JSON.stringify({
        respond_with: "json",
        keyword: plan.keyword,
        cluster: plan.topicCluster,
        search_intent: plan.searchIntent,
        audience_problem: plan.audienceProblem,
        post: { slug, title, angle: base.angle, reader_job: base.readerJob, outline },
        known_paths: input.knownPaths.slice(0, 60),
        ...requestContext(input),
      }),
      webSearch: false,
      ...(input.gateway ? { gateway: input.gateway } : {}),
    });

    const parsed = extractJsonObject(raw) as RawPost;
    const draft = String(parsed.draft_markdown ?? "").trim();
    const prepared: PreparedItem = {
      ...base,
      brief: { outline, mustCover: strings(parsed.must_cover), sources: [] },
      draftMarkdown: draft,
      hitRationale: String(parsed.hit_rationale ?? "").trim(),
      seo: {
        title: String(parsed.seo_title ?? "").trim(),
        metaDescription: String(parsed.meta_description ?? "").trim(),
        slug: slugify(String(parsed.slug ?? slug)) || slug,
      },
      internalLinks: resolveLinks(parsed.internal_links, input.knownPaths),
      cta: {
        readerNeed: String(parsed.cta?.reader_need ?? "").trim(),
        offer: String(parsed.cta?.offer ?? "").trim(),
        line: String(parsed.cta?.line ?? "").trim(),
      },
      taxonomy: {
        category: String(parsed.category ?? "").trim(),
        tags: strings(parsed.tags).slice(0, 6),
      },
      image: {
        /* No image provider is wired to the runtime, so the brief is real and
           the asset is honestly absent. Nothing is claimed. */
        state: "unavailable",
        brief: String(parsed.image_brief ?? "").trim(),
        altText: String(parsed.alt_text ?? "").trim(),
        assetUrl: null,
        provider: null,
      },
      generation: { provider, model, at },
    };

    const readiness = assessItem(prepared, { requireImage: true });
    return {
      ...prepared,
      state: readiness.state,
      exceptionReasons: readiness.reasons,
      failureReason: readiness.state === "failed" ? readiness.notes.join(" ") : null,
    };
  } catch (error) {
    return {
      ...base,
      state: "failed",
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run the command, reporting each stage as it happens.
 *
 * The plan is one model call; each post is its own call, so one bad post
 * cannot take the package down with it.
 */
export async function* runContentCommand(
  input: ContentCommandInput,
): AsyncGenerator<ContentStage> {
  const callModel = await runtimeModelCaller({
    token: input.token,
    organizationId: input.organizationId,
    room: "studio",
    purpose: "studio_generation",
  });

  yield { stage: "plan", message: `Planning a cluster around "${input.keyword}".` };
  const { plan, posts } = await planCluster(callModel, input);
  yield { stage: "plan", message: `${posts.length} posts planned.`, data: plan };

  const prepared: PreparedItem[] = [];
  for (let index = 0; index < posts.length; index += 1) {
    const brief = posts[index]!;
    yield {
      stage: "post",
      message: `Writing ${index + 1} of ${posts.length}: ${String(brief.title ?? brief.slug ?? "")}`,
    };
    const item = await writePost(callModel, input, plan, brief, index);
    prepared.push(item);
    yield {
      stage: "post",
      message:
        item.state === "failed"
          ? `Post ${index + 1} could not be prepared. The rest of the batch continues.`
          : `Post ${index + 1} prepared.`,
      data: item,
    };
  }

  yield {
    stage: "complete",
    message: "The editorial batch is ready for review.",
    data: { plan, items: prepared },
  };
}
