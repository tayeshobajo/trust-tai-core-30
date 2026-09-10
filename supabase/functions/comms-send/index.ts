/**
 * comms-send. Supabase Edge Function
 *
 * Sends an approved comms draft via Resend. Called by Tai (or Trust Tai OS UI)
 * after human review. Never called by agents.
 *
 * Auth: standard Supabase JWT (Tai's session token, not agent key)
 * Body: { draft_id: string }
 *
 * What it does:
 * 1. Validates the draft belongs to Tai's org and is in `approved` state
 * 2. Looks up the relationship for the To: address
 * 3. Sends via Resend
 * 4. Inserts a `comms_messages` record (direction: outbound)
 * 5. Updates draft review_state to `sent`
 * 6. Updates relationship stage to `introduced` if it was `new`
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM = Deno.env.get("RESEND_FROM_EMAIL") ?? "hello@trusttai.com";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function fail(message: string, status: number): Response {
  return json({ error: message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") return fail("Method not allowed.", 405);

  // Auth: require a valid Supabase JWT (Tai's session)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return fail("Authorization required.", 401);

  const userJwt = authHeader.slice(7);
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) return fail("Invalid session.", 401);

  // Parse body
  let draftId: string;
  try {
    const body = await req.json() as Record<string, unknown>;
    draftId = typeof body.draft_id === "string" ? body.draft_id.trim(): "";
  } catch {
    return fail("Invalid JSON body.", 400);
  }
  if (!draftId) return fail("draft_id is required.", 400);

  // Fetch the draft (service role, bypasses RLS for send path)
  const { data: draft, error: draftError } = await supabase
.from("comms_drafts")
.select("id, organization_id, relationship_id, subject, body, review_state")
.eq("id", draftId)
.maybeSingle();
  if (draftError) return fail(draftError.message, 500);
  if (!draft) return fail("Draft not found.", 404);

  const d = draft as Record<string, unknown>;

  // Must be approved
  if (d["review_state"] !== "approved") {
    return fail(`Draft is not approved (state: ${d["review_state"]}). Approve it first.`, 422);
  }

  // Fetch the relationship for the To: address
  const { data: relationship, error: relError } = await supabase
.from("comms_relationships")
.select("id, organization_id, full_name, email, stage")
.eq("id", d["relationship_id"] as string)
.maybeSingle();
  if (relError) return fail(relError.message, 500);
  if (!relationship) return fail("Relationship not found.", 404);

  const r = relationship as Record<string, unknown>;
  const toEmail = r["email"] as string | null;
  if (!toEmail) {
    return fail("Relationship has no email address. Add one before sending.", 422);
  }

  // Mark as sending (optimistic lock)
  const { error: lockError } = await supabase
.from("comms_drafts")
.update({ review_state: "sending", updated_at: new Date().toISOString() })
.eq("id", draftId)
.eq("review_state", "approved");
  if (lockError) return fail("Could not lock draft for sending.", 500);

  // Send via Resend
  const subject = typeof d["subject"] === "string" && d["subject"] ? d["subject"]: `A note from Trust Tai`;
  const bodyText = d["body"] as string;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `Tai at Trust Tai <${RESEND_FROM}>`,
      to: [toEmail],
      subject,
      text: bodyText,
    }),
  });

  if (!resendResponse.ok) {
    const resendError = await resendResponse.text();
    // Roll back to approved so Tai can retry
    await supabase
.from("comms_drafts")
.update({ review_state: "approved", updated_at: new Date().toISOString() })
.eq("id", draftId);
    return fail(`Resend error: ${resendError}`, 502);
  }

  const resendData = await resendResponse.json() as { id?: string };
  const resendMessageId = resendData.id ?? `resend-${Date.now()}`;

  const now = new Date().toISOString();

  // Mark draft as sent
  await supabase
.from("comms_drafts")
.update({ review_state: "sent", updated_at: now })
.eq("id", draftId);

  // Insert outbound message record
  const { data: messageRow } = await supabase
.from("comms_messages")
.upsert(
      {
        organization_id: d["organization_id"],
        relationship_id: d["relationship_id"],
        provider: "resend",
        provider_message_id: resendMessageId,
        direction: "outbound",
        from_email: RESEND_FROM,
        from_name: "Tai",
        to_emails: [toEmail],
        cc_emails: [],
        subject,
        snippet: bodyText.slice(0, 200),
        body_text: bodyText,
        occurred_at: now,
        provenance: {
          source: "comms_send_fn",
          draft_id: draftId,
          sent_by: user.id,
          sent_at: now,
        },
      },
      { onConflict: "organization_id,provider,provider_message_id", ignoreDuplicates: true },
    )
.select("id")
.maybeSingle();

  // Update relationship stage to introduced (only if still new)
  if (r["stage"] === "new") {
    await supabase
.from("comms_relationships")
.update({ stage: "introduced", last_touch_at: now, updated_at: now })
.eq("id", d["relationship_id"] as string);
  } else {
    await supabase
.from("comms_relationships")
.update({ last_touch_at: now, updated_at: now })
.eq("id", d["relationship_id"] as string);
  }

  return json({
    sent: true,
    draft_id: draftId,
    resend_id: resendMessageId,
    to: toEmail,
    subject,
    message_id: (messageRow as { id?: string } | null)?.id ?? null,
  });
});
