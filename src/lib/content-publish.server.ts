/**
 * Publishing to trusttai.com (server only).
 *
 * The law this file exists to hold: approved is not queued, queued is not
 * published, and published is not verified. Each is a separate state with its
 * own evidence, and only the live website can produce the last one.
 *
 *   queued        a person approved the post and Studio holds it
 *   publishing    a transport attempt is in flight, recorded before it starts
 *   published     the publisher returned a receipt with a canonical URL
 *   verified      that URL was read back and really carried the article
 *
 * A failed attempt returns the post to queued with the reason attached, and
 * every attempt is appended to `content_publish_attempts`, so a post cannot
 * quietly become published. The same post is never sent twice: the stable
 * publish key travels as the publisher's idempotency key, and a post that
 * already carries an external id is not sent again.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";
import {
  publishRefusal,
  verifyPublished,
  type ContentPublish,
  type ContentVerification,
} from "@/domain/content";

export interface PublishProviderStatus {
  configured: boolean;
  endpoint: string | null;
  because: string;
}

const PROVIDER = "trusttai.com";

function endpoint(): string | null {
  const value = process.env["TRUST_TAI_PUBLISH_ENDPOINT"];
  return value && value.trim() ? value.trim() : null;
}

function transportToken(): string | null {
  const value = process.env["TRUST_TAI_PUBLISH_TOKEN"];
  return value && value.trim() ? value.trim() : null;
}

/** What the room may honestly say about publishing being wired at all. */
export function publishProviderStatus(): PublishProviderStatus {
  const url = endpoint();
  const token = transportToken();
  if (!url || !token) {
    return {
      configured: false,
      endpoint: url,
      because:
        "No publishing endpoint is connected yet, so approved posts stay queued in Studio rather than pretending to go live.",
    };
  }
  return { configured: true, endpoint: url, because: "Connected to the trusttai.com publisher." };
}

/* -------------------------------------------------------------- database */

type Row = Record<string, unknown>;

/** The caller's own session, so every read and write stays under RLS. */
function clientFor(token: string): SupabaseClient {
  return createClient(trustTaiSupabaseUrl(), trustTaiSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

/**
 * The attempt ledger is written with a privileged, server-only client.
 *
 * Members may read the ledger and nothing else: an attempt record is evidence
 * about what the system did, so the system writes it and a person cannot. The
 * key lives only in this process and is read at call time, never at module
 * scope and never anywhere the browser can reach.
 */
function ledgerClient(): SupabaseClient {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] || process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new Error(
      "The publish attempt ledger cannot be written, so nothing was sent to trusttai.com. Set TRUST_TAI_SUPABASE_SERVICE_KEY.",
    );
  }
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  });
}

async function loadItem(
  client: SupabaseClient,
  organizationId: string,
  itemId: string,
): Promise<Row> {
  const { data, error } = await client
    .from("content_items")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", itemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That post is not in this workspace.");
  return data as Row;
}

async function patchItem(
  client: SupabaseClient,
  organizationId: string,
  itemId: string,
  patch: Row,
): Promise<void> {
  const { error } = await client
    .from("content_items")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("id", itemId);
  if (error) throw new Error(error.message);
}

/**
 * Every attempt is written, successful or not, and the write is not optional.
 *
 * No durable attempt record means no external publish call: if this throws,
 * the caller aborts before the transport, because an unrecorded send is a
 * publish nobody can prove or undo.
 */
async function recordAttempt(
  ledger: SupabaseClient,
  organizationId: string,
  item: Row,
  input: { state: "attempted" | "executed" | "failed"; because: string; receipt?: Row },
): Promise<void> {
  const { error } = await ledger.from("content_publish_attempts").insert({
    id: `cpa_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    organization_id: organizationId,
    item_id: String(item["id"]),
    publish_key: String(item["publish_key"] ?? item["id"]),
    state: input.state,
    provider: PROVIDER,
    because: input.because,
    receipt: input.receipt ?? {},
    created_at: new Date().toISOString(),
  });
  if (error) {
    throw new Error(`The publish attempt could not be recorded, so nothing was sent: ${error.message}`);
  }
}

/**
 * Has this exact publish key already gone out?
 *
 * Idempotency lives on the publish key, not on a click. An executed attempt
 * carries the receipt, and a duplicate request resolves to that receipt
 * rather than becoming a second article.
 */
async function executedAttempt(
  ledger: SupabaseClient,
  organizationId: string,
  publishKey: string,
): Promise<ProviderReceipt | null> {
  const { data, error } = await ledger
    .from("content_publish_attempts")
    .select("receipt")
    .eq("organization_id", organizationId)
    .eq("publish_key", publishKey)
    .eq("state", "executed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const receipt = (data?.["receipt"] ?? null) as Row | null;
  const canonicalUrl = String(receipt?.["canonicalUrl"] ?? "").trim();
  const externalPostId = String(receipt?.["externalPostId"] ?? "").trim();
  if (!canonicalUrl || !externalPostId) return null;
  return {
    canonicalUrl,
    externalPostId,
    publishedAt: String(receipt?.["publishedAt"] ?? new Date().toISOString()),
  };
}


/* ------------------------------------------------------------- transport */

interface ProviderReceipt {
  externalPostId: string;
  canonicalUrl: string;
  publishedAt: string;
}

/**
 * One transport attempt. The publisher must return a canonical URL, because
 * without one there is nothing to verify and nothing to show a person.
 */
async function sendToPublisher(
  item: Row,
  publishKey: string,
): Promise<{ ok: true; receipt: ProviderReceipt } | { ok: false; because: string }> {
  const url = endpoint();
  const token = transportToken();
  if (!url || !token) return { ok: false, because: publishProviderStatus().because };

  const seo = (item["seo"] ?? {}) as Row;
  const image = (item["image"] ?? {}) as Row;
  const taxonomy = (item["taxonomy"] ?? {}) as Row;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "idempotency-key": publishKey,
      },
      body: JSON.stringify({
        idempotency_key: publishKey,
        slug: String(seo["slug"] ?? item["slug"] ?? ""),
        title: String(item["title"] ?? ""),
        seo_title: String(seo["title"] ?? ""),
        meta_description: String(seo["metaDescription"] ?? ""),
        body_markdown: String(item["draft_markdown"] ?? ""),
        category: String(taxonomy["category"] ?? ""),
        tags: Array.isArray(taxonomy["tags"]) ? taxonomy["tags"] : [],
        image: { url: image["assetUrl"] ?? null, alt: String(image["altText"] ?? "") },
      }),
    });
  } catch (error) {
    return {
      ok: false,
      because: `The publisher could not be reached: ${(error as Error).message}`,
    };
  }

  const text = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      because: `The publisher refused the post (${response.status}). ${text.slice(0, 200)}`.trim(),
    };
  }

  let parsed: Row;
  try {
    parsed = JSON.parse(text) as Row;
  } catch {
    return { ok: false, because: "The publisher replied with something that was not a receipt." };
  }

  const canonicalUrl = String(parsed["url"] ?? parsed["canonical_url"] ?? "").trim();
  const externalPostId = String(parsed["id"] ?? parsed["post_id"] ?? "").trim();
  if (!canonicalUrl || !externalPostId) {
    return {
      ok: false,
      because: "The publisher returned no canonical URL, so the post cannot be called published.",
    };
  }

  return {
    ok: true,
    receipt: {
      externalPostId,
      canonicalUrl,
      publishedAt: String(parsed["published_at"] ?? new Date().toISOString()),
    },
  };
}

/* --------------------------------------------------------------- publish */

export interface PublishOutcome {
  itemId: string;
  state: "executed" | "failed" | "refused";
  because: string;
  canonicalUrl: string | null;
}

/**
 * Publish one approved, queued post.
 *
 * The image gate is deliberately not re-applied here: a missing image is an
 * exception a person already saw and accepted in Approvals, and re-refusing it
 * at the transport would overrule that judgment.
 */
export async function publishQueuedItem(input: {
  token: string;
  organizationId: string;
  itemId: string;
}): Promise<PublishOutcome> {
  const client = clientFor(input.token);
  const item = await loadItem(client, input.organizationId, input.itemId);
  const state = String(item["state"] ?? "");
  const image = (item["image"] ?? {}) as Row;
  const publishKey = String(item["publish_key"] ?? item["id"]);

  if (item["external_post_id"]) {
    return {
      itemId: input.itemId,
      state: "executed",
      because: "This post is already live, so nothing was sent again.",
      canonicalUrl: (item["canonical_url"] as string) ?? null,
    };
  }

  /* The ledger has to be reachable before anything else is considered. No
     durable attempt record means no external publish call. */
  const ledger = ledgerClient();

  /* Idempotency on the publish key: a second request resolves to the receipt
     the first one already earned, rather than becoming a second article. */
  const already = await executedAttempt(ledger, input.organizationId, publishKey);
  if (already) {
    await patchItem(client, input.organizationId, input.itemId, {
      state: "published",
      external_post_id: already.externalPostId,
      canonical_url: already.canonicalUrl,
      published_at: already.publishedAt,
    });
    return {
      itemId: input.itemId,
      state: "executed",
      because: "This post was already published under the same publish key, so nothing was sent again.",
      canonicalUrl: already.canonicalUrl,
    };
  }

  const refusal = publishRefusal(
    {
      state: state as never,
      image: { state: String(image["state"] ?? "unavailable") } as never,
      externalPostId: null,
    },
    { requireImage: false },
  );
  if (refusal) {
    return { itemId: input.itemId, state: "refused", because: refusal.because, canonicalUrl: null };
  }
  if (state !== "queued") {
    return {
      itemId: input.itemId,
      state: "refused",
      because: `Only a post a person approved and queued can be published. This one is ${state.replace(/_/g, " ")}.`,
      canonicalUrl: null,
    };
  }

  const attemptedAt = new Date().toISOString();
  const attempting: ContentPublish = {
    state: "attempted",
    attemptedAt,
    provider: PROVIDER,
    because: "Sent to the publisher.",
  };
  /* Written before the transport, so a crash mid-flight is visible as an
     attempt rather than as silence. */
  await recordAttempt(ledger, input.organizationId, item, {
    state: "attempted",
    because: "Sent to the publisher.",
  });
  await patchItem(client, input.organizationId, input.itemId, {
    state: "publishing",
    publish: attempting,
  });


  const sent = await sendToPublisher(item, publishKey);

  if (!sent.ok) {
    const failed: ContentPublish = {
      state: "failed",
      attemptedAt,
      provider: PROVIDER,
      because: sent.because,
    };
    await patchItem(client, input.organizationId, input.itemId, {
      state: "queued",
      publish: failed,
    });
    await recordAttempt(client, input.organizationId, item, {
      state: "failed",
      because: sent.because,
    });
    return { itemId: input.itemId, state: "failed", because: sent.because, canonicalUrl: null };
  }

  const executedAt = new Date().toISOString();
  const executed: ContentPublish = {
    state: "executed",
    attemptedAt,
    executedAt,
    provider: PROVIDER,
    because: `The publisher returned ${sent.receipt.canonicalUrl}.`,
    receipt: { ...sent.receipt },
  };
  const unverified: ContentVerification = {
    state: "unverified",
    because: "Published. The live page has not been read back yet.",
  };
  await patchItem(client, input.organizationId, input.itemId, {
    state: "published",
    external_post_id: sent.receipt.externalPostId,
    canonical_url: sent.receipt.canonicalUrl,
    published_at: sent.receipt.publishedAt,
    publish: executed,
    verification: unverified,
  });
  await recordAttempt(client, input.organizationId, item, {
    state: "executed",
    because: executed.because ?? "Published.",
    receipt: { ...sent.receipt },
  });

  return {
    itemId: input.itemId,
    state: "executed",
    because: `Published at ${sent.receipt.canonicalUrl}. It is not verified until the live page is read back.`,
    canonicalUrl: sent.receipt.canonicalUrl,
  };
}

/* --------------------------------------------------------------- verify */

export interface VerifyOutcome {
  itemId: string;
  verification: ContentVerification;
}

/**
 * Read the published article back from the website.
 *
 * Verification is evidence, not optimism: the URL must answer, carry the
 * expected canonical path and carry the article title. Anything else leaves
 * the post published and honestly unverified.
 */
export async function verifyPublishedItem(input: {
  token: string;
  organizationId: string;
  itemId: string;
}): Promise<VerifyOutcome> {
  const client = clientFor(input.token);
  const item = await loadItem(client, input.organizationId, input.itemId);
  const canonicalUrl = String(item["canonical_url"] ?? "");
  const seo = (item["seo"] ?? {}) as Row;

  if (!canonicalUrl) {
    return {
      itemId: input.itemId,
      verification: {
        state: "unverified",
        because: "This post has no canonical URL yet, so there is nothing to read back.",
      },
    };
  }

  let verification: ContentVerification;
  try {
    const response = await fetch(canonicalUrl, { headers: { accept: "text/html" } });
    const html = response.ok ? await response.text() : "";
    verification = verifyPublished({
      httpStatus: response.status,
      html,
      requestedUrl: canonicalUrl,
      expectedTitle: String(item["title"] ?? ""),
      expectedSlug: String(seo["slug"] ?? item["slug"] ?? ""),
    });
  } catch (error) {
    verification = {
      state: "failed",
      checkedAt: new Date().toISOString(),
      canonicalUrl,
      because: `The live page could not be reached: ${(error as Error).message}`,
    };
  }

  await patchItem(client, input.organizationId, input.itemId, {
    ...(verification.state === "verified" ? { state: "verified" } : {}),
    verification,
  });

  return { itemId: input.itemId, verification };
}
