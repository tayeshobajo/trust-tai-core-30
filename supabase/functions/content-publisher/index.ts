/**
 * content-publisher. Supabase Edge Function
 *
 * The receiving end of Studio's publish pipe (src/lib/content-publish.server.ts).
 * Studio POSTs an approved post here with a bearer token; this function makes it
 * durable in `published_posts` and returns the receipt Studio requires:
 * { id, canonical_url, published_at } (sender reads `id`/`post_id` + `url`/`canonical_url`).
 *
 * trusttai.com renders `published_posts` read-only via the anon key, so the
 * public site carries no secret and this function is the only writer.
 *
 * Contract held for the sender (see sendToPublisher):
 *   - Bearer auth against CONTENT_PUBLISH_TOKEN (set via supabase secrets).
 *   - Idempotent on publish_key: replaying the same key returns the original
 *     receipt with 200, never a duplicate row. Same slug + different key = 409.
 *   - The canonical URL is https://trusttai.com/blog/<slug>; Studio verifies it
 *     by reading it back, so this function never claims a URL it cannot stand
 *     behind — the blog route on trusttai.com serves straight from this table.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLISH_TOKEN = Deno.env.get("CONTENT_PUBLISH_TOKEN");
// Single-org publisher today. If a second org ever publishes, the token, not
// the payload, must decide the org — payloads don't get to claim identity.
const ORGANIZATION_ID = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const SITE_BASE = "https://trusttai.com";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const ba = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!PUBLISH_TOKEN || !token || !timingSafeEqual(token, PUBLISH_TOKEN)) {
    return json({ error: "Invalid publish token." }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const publishKey =
    typeof body.idempotency_key === "string" && body.idempotency_key.trim()
      ? body.idempotency_key.trim()
      : req.headers.get("idempotency-key")?.trim() ?? "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const markdown = typeof body.body_markdown === "string" ? body.body_markdown : "";
  const rawSlug = typeof body.slug === "string" && body.slug.trim() ? body.slug.trim() : title;
  const slug = slugify(rawSlug);

  if (!publishKey) return json({ error: "idempotency_key is required." }, 400);
  if (!title) return json({ error: "title is required." }, 400);
  if (!markdown.trim()) return json({ error: "body_markdown is required." }, 400);
  if (!slug) return json({ error: "A usable slug could not be derived." }, 400);

  // Idempotent replay: same publish key returns the original receipt.
  const { data: existing, error: existingError } = await supabase
    .from("published_posts")
    .select("id, slug, published_at")
    .eq("publish_key", publishKey)
    .maybeSingle();
  if (existingError) return json({ error: existingError.message }, 500);
  if (existing) {
    return json({
      id: existing.id,
      canonical_url: `${SITE_BASE}/blog/${existing.slug}`,
      published_at: existing.published_at,
      replay: true,
    });
  }

  // Same slug under a different key is a real conflict, not a replay.
  const { data: slugRow, error: slugError } = await supabase
    .from("published_posts")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (slugError) return json({ error: slugError.message }, 500);
  if (slugRow) {
    return json({ error: `A different post already owns the slug "${slug}".` }, 409);
  }

  const { data: created, error: insertError } = await supabase
    .from("published_posts")
    .insert({
      organization_id: ORGANIZATION_ID,
      publish_key: publishKey,
      slug,
      title,
      seo_title: typeof body.seo_title === "string" ? body.seo_title.trim() || null : null,
      meta_description:
        typeof body.meta_description === "string" ? body.meta_description.trim() || null : null,
      body_markdown: markdown,
      category: typeof body.category === "string" ? body.category.trim() || null : null,
      tags: Array.isArray(body.tags) ? body.tags : [],
      image: body.image && typeof body.image === "object" ? body.image : {},
    })
    .select("id, slug, published_at")
    .single();
  if (insertError) return json({ error: insertError.message }, 500);

  return json({
    id: created.id,
    canonical_url: `${SITE_BASE}/blog/${created.slug}`,
    published_at: created.published_at,
  });
});
