import { z } from "zod";
import type { Roadmap } from "./roadmap";
import { editableValues } from "./roadmap-tracker-edit";
import { sha256 } from "./sha256";

const timestamp = z.string().datetime({ offset: true });
const sourceUrl = z
  .string()
  .url()
  .refine((s) => new URL(s).protocol === "https:");
const emailAddress = z.preprocess(
  (value) => (typeof value === "string" ? (value.match(/<([^<>]+)>/)?.[1] ?? value) : value),
  z.string().email(),
);
const message = z
  .object({
    type: z.enum(["email_sent", "email_received", "email_team_outbound_copy"]),
    from: emailAddress,
    to: z.array(z.string().email()),
    subject: z.string(),
    from_header: z.string().optional(),
    to_header: z.string().optional(),
    cc_header: z.string().optional(),
    content_safety: z.string().optional(),
    sent_at: timestamp,
    provider: z.literal("gmail"),
    provider_message_id: z.string().min(1),
    provider_thread_id: z.string().min(1),
    source_url: sourceUrl,
    // The mailbox is explicit for received messages. Legacy sent rows identify it by sender.
    mailbox: z.string().email().optional(),
    verification: z.string().min(1).optional(),
    verified_at: timestamp.optional(),
    provider_draft_id: z.string().optional(),
    body_exact: z.string(),
    body_format: z.enum(["text/html", "text/plain"]),
    rfc_message_id: z.string().optional(),
    body_sha256: z.string().optional(),
  })
  .refine((m) => Boolean(m.verification || m.verified_at), "Message requires source verification")
  .refine(
    (m) => m.type === "email_sent" || Boolean(m.mailbox),
    "Received messages and team copies require mailbox provenance",
  );
const draftReceipt = z.object({
  type: z.literal("email_draft_saved"),
  provider: z.literal("gmail"),
  provider_draft_id: z.string().min(1),
  provider_message_id: z.string().min(1),
  provider_thread_id: z.string().min(1),
  from: z.string().email(),
  to: z.array(z.string().email()),
  subject: z.string(),
  body_plain_text_content_only: z.string(),
  draft_only: z.literal(true),
  sent_at: z.null(),
  saved_message_timestamp: timestamp,
  verified_at: timestamp,
  source_url: sourceUrl,
  verification: z.union([
    z.string().min(1),
    z.object({
      body_matches: z.literal(true),
      to_matches: z.literal(true),
      from_matches: z.literal(true),
      draft_only: z.literal(true),
    }),
  ]),
});
const draftState = z.object({
  type: z.literal("email_draft_state_verified"),
  provider: z.literal("gmail"),
  provider_draft_id: z.string().min(1),
  provider_message_id: z.string().min(1),
  provider_thread_id: z.string().min(1),
  from: emailAddress,
  to: z.array(z.string().email()),
  subject: z.string(),
  body_exact: z.string(),
  body_format: z.enum(["text/plain", "text/html"]),
  draft_only: z.literal(true),
  message_timestamp: timestamp,
  verified_at: timestamp,
  source_url: sourceUrl,
});
const deliveryFailure = z.object({
  type: z.literal("email_delivery_failed"),
  provider_message_id: z.string().min(1),
  provider_thread_id: z.string().min(1),
  occurred_at: timestamp,
  smtp_status: z.string().min(1),
  reason: z.string().min(1),
  source_url: sourceUrl,
});
export const reviewManifestSchema = z
  .object({
    schema: z.literal("trusttai.roadmap_reconciliation.review.v1"),
    created_at: timestamp,
    updated_at: timestamp.optional(),
    scope: z.string().min(1),
    mode: z.literal("read_only_staging_no_cmd_writes"),
    canonical_target: z.literal("https://cmd.trusttai.com"),
    global_holds: z.array(z.string()),
    mailbox_coverage: z.object({ checked_at: timestamp, coverage: z.string() }),
    rows: z.array(
      z.object({
        roadmap_slug: z.string().regex(/^[a-z0-9-]+$/),
        business_name: z.string().min(1),
        canonical_cmd_record_id: z.string().uuid().nullable(),
        canonical_mapping_required: z.boolean(),
        owner: z.string(),
        public_roadmap_url: sourceUrl,
        roadmap_status: z.object({
          prepared: z.boolean(),
          published: z.boolean(),
          verification: z.string(),
        }),
        recipient: z.object({
          name: z.string(),
          email: z.string().email().nullable(),
          verification_status: z.enum([
            "verified_named_direct",
            "held_unverified_named_direct",
            "official_business_route_user_approved_not_owner_direct",
          ]),
          disposition: z.string(),
          source_refs: z.array(sourceUrl),
        }),
        outreach_status: z.object({
          prepared_email: z.boolean(),
          sent: z.string(),
          send_execution_allowed: z.literal(false),
          approval_status: z.string(),
          coverage_caveat: z.string(),
          mailbox_draft_saved: z.boolean().optional(),
        }),
        prepared_message: z
          .object({
            from: z.string().email(),
            to: z.array(z.string().email()),
            cc: z.array(z.string()),
            bcc: z.array(z.string()),
            subject: z.string(),
            body_markdown_exact: z.string(),
            signature_text_exact: z.string().optional(),
            signature_mode: z.string().optional(),
            body_scope: z.string().optional(),
            footer: z.string().nullable(),
            footer_status: z.string(),
            body_sha256: z.string(),
            source_artifacts: z.array(z.string()),
            mailbox_draft_created: z.boolean(),
            current_mailbox_subject: z.string().optional(),
            current_mailbox_authored_body_and_footer: z.string().optional(),
          })
          .nullable(),
        interactions: z.array(z.union([message, draftReceipt, draftState, deliveryFailure])),
        next_action: z.string(),
        due_at: timestamp.nullable(),
        evidence_checked_at: timestamp,
      }),
    ),
  })
  .superRefine((m, ctx) => {
    const slugs = new Set<string>();
    const drafts = new Set<string>();
    m.rows.forEach((r, i) => {
      if (slugs.has(r.roadmap_slug))
        ctx.addIssue({ code: "custom", message: "Duplicate source identity", path: ["rows", i] });
      slugs.add(r.roadmap_slug);
      if (
        r.prepared_message &&
        sha256(r.prepared_message.body_markdown_exact) !== r.prepared_message.body_sha256
      )
        ctx.addIssue({
          code: "custom",
          message: "Prepared body digest mismatch",
          path: ["rows", i],
        });
      for (const receipt of r.interactions) {
        if (receipt.type !== "email_draft_saved") continue;
        const key = `${receipt.from}:${receipt.provider_draft_id}`;
        if (drafts.has(key))
          ctx.addIssue({ code: "custom", message: "Duplicate draft identity", path: ["rows", i] });
        drafts.add(key);
        if (
          r.interactions.some(
            (item) =>
              item.type === "email_draft_state_verified" ||
              (item.type === "email_sent" && item.provider_draft_id === receipt.provider_draft_id),
          )
        )
          continue;
        const prepared = r.prepared_message;
        if (
          !prepared ||
          receipt.subject !== prepared.subject ||
          receipt.from !== prepared.from ||
          receipt.body_plain_text_content_only !== prepared.body_markdown_exact ||
          JSON.stringify([...receipt.to].sort()) !== JSON.stringify([...prepared.to].sort())
        )
          ctx.addIssue({
            code: "custom",
            message: "Draft receipt differs from prepared content",
            path: ["rows", i],
          });
      }

      if (
        new URL(r.public_roadmap_url).origin !== "https://trusttai.com" ||
        new URL(r.public_roadmap_url).pathname !== `/clients/${r.roadmap_slug}`
      )
        ctx.addIssue({
          code: "custom",
          message: "Publication URL does not match identity",
          path: ["rows", i],
        });
    });
  });
export type ReviewManifest = z.infer<typeof reviewManifestSchema>;
export type ReviewRow = ReviewManifest["rows"][number];
export type MessageEvidence = z.infer<typeof message>;
export type ObservedMessage = {
  alternateText?: { text: string; source: string; note: string }[];
  message: MessageEvidence;
  sources: string[];
  mailboxes: string[];
  conflict: boolean;
};

/** Never deduplicate by subject, company name or body alone. Retain conflicting observations. */
export function deduplicateMessages(messages: MessageEvidence[]): ObservedMessage[] {
  const groups = new Map<string, MessageEvidence[]>();
  for (const m of messages) {
    const mailbox = m.mailbox ?? m.from;
    const key = m.rfc_message_id?.trim()
      ? `rfc:${m.rfc_message_id.trim()}`
      : `${m.provider}:${mailbox}:${m.provider_message_id}`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()]
    .flatMap((group) => {
      const variants = new Map<string, MessageEvidence[]>();
      for (const m of group) {
        const fingerprint = sha256(
          JSON.stringify([
            m.type,
            m.from,
            [...m.to].sort(),
            m.subject,
            Date.parse(m.sent_at),
            m.body_format,
            m.body_exact,
          ]),
        );
        variants.set(fingerprint, [...(variants.get(fingerprint) ?? []), m]);
      }
      return [...variants.values()].map((observations) => ({
        message: observations[0]!,
        sources: [...new Set(observations.map((m) => m.source_url))],
        mailboxes: [...new Set(observations.map((m) => m.mailbox ?? m.from))],
        conflict:
          variants.size > 1 ||
          observations.some((m) =>
            Boolean(m.body_sha256 && m.body_sha256 !== sha256(m.body_exact)),
          ),
      }));
    })
    .sort((a, b) => Date.parse(b.message.sent_at) - Date.parse(a.message.sent_at));
}
export interface ReviewedBinding {
  slug: string;
  roadmapId: string;
  organizationId: string;
  reviewedBy: string;
  reviewedAt: string;
}
export interface PublicationObservation {
  checkedAt: string;
  sourceUrl: string;
  entries: { slug: string; name: string; url: string; identityHold?: string }[];
}
export const linkedInEvidenceSchema = z.object({
  updated_at: timestamp,
  records: z.array(
    z
      .object({
        slug: z.string().min(1),
        recipient: z.string(),
        profile_url: sourceUrl.refine(
          (url) => new URL(url).hostname === "www.linkedin.com",
          "LinkedIn profile required",
        ),
        subject: z.string(),
        body: z.string(),
        status: z.enum(["sent_ui_verified", "received_ui_verified"]),
        observed_send_time_utc_approx: timestamp.optional(),
        observed_at: timestamp.optional(),
        timestamp_precision: z.enum(["exact", "approximate"]).optional(),
        receipt: z.string(),
      })
      .refine(
        (event) => Boolean(event.observed_at || event.observed_send_time_utc_approx),
        "An observed timestamp is required",
      )
      .refine(
        (event) => event.status !== "received_ui_verified" || Boolean(event.observed_at),
        "Received events require observed_at",
      ),
  ),
});
export type LinkedInEvidence = z.infer<typeof linkedInEvidenceSchema>;
export interface EvidenceRecord {
  importedActivity?: import("./roadmap-correspondence-summary").ConversationSummary["records"][number];
  linkedIn?: LinkedInEvidence["records"][number];
  linkedInEvents?: LinkedInEvidence["records"];
  coverage?: PartialCoverage["rows"][number];
  publication?: PublicationObservation["entries"][number];
  key: string;
  name: string;
  native?: Roadmap;
  review?: ReviewRow;
  binding: "canonical" | "reviewed" | "pending";
  owner: string;
  nextAction: string;
  followUp: string | null;
  messages: ObservedMessage[];
}
/** A manifest ID alone never grants a binding. Scope and explicit review must both match. */
export function projectEvidence(
  roadmaps: Roadmap[],
  organizationId: string,
  manifest?: ReviewManifest,
  bindings: ReviewedBinding[] = [],
  publication?: PublicationObservation,
  history?: PartialInteractionHistory,
  coverage?: PartialCoverage,
): EvidenceRecord[] {
  const native = roadmaps.filter((r) => r.organizationId === organizationId);
  const records: EvidenceRecord[] = native.map((r) => ({
    key: `canonical:${r.id}`,
    name: r.subjectLabel || r.title,
    native: r,
    binding: "canonical",
    owner:
      (r.nextMove?.ownerUserId === r.ownerUserId ? r.nextMove?.ownerLabel : undefined) ??
      (r.ownerUserId ? "Assigned · open saved record" : "Unassigned"),
    nextAction: editableValues(r).nextAction ?? "Next action unknown",
    followUp: editableValues(r).followUpDate ?? null,
    messages: [],
  }));
  const reviewedTarget = (slug: string) => {
    const matches = bindings.filter(
      (b) =>
        b.slug === slug &&
        !publication?.entries.some((entry) => entry.slug === b.slug && entry.identityHold) &&
        b.organizationId === organizationId &&
        b.reviewedBy.trim() &&
        Number.isFinite(Date.parse(b.reviewedAt)),
    );
    const binding = matches.length === 1 ? matches[0] : undefined;
    return binding &&
      bindings.filter(
        (b) => b.organizationId === organizationId && b.roadmapId === binding.roadmapId,
      ).length === 1
      ? records.find((r) => r.native?.id === binding.roadmapId)
      : undefined;
  };
  for (const row of manifest?.rows ?? []) {
    const target = reviewedTarget(row.roadmap_slug);
    const messages = deduplicateMessages(
      row.interactions.filter((m): m is MessageEvidence =>
        ["email_sent", "email_received", "email_team_outbound_copy"].includes(m.type),
      ),
    );
    if (target) Object.assign(target, { review: row, binding: "reviewed", messages });
    else
      records.push({
        key: `review:${row.roadmap_slug}`,
        name: row.business_name,
        review: row,
        binding: "pending",
        owner: `${row.owner} · source label`,
        nextAction: row.next_action,
        followUp: row.due_at,
        messages,
      });
  }
  for (const entry of publication?.entries ?? []) {
    const matches = records.filter(
      (r) => r.review?.roadmap_slug === entry.slug && r.review.public_roadmap_url === entry.url,
    );
    const nativeTarget = matches.length === 0 ? reviewedTarget(entry.slug) : undefined;
    if (matches.length === 1) matches[0]!.publication = entry;
    else if (nativeTarget) Object.assign(nativeTarget, { publication: entry, binding: "reviewed" });
    else
      records.push({
        key: `publication:${entry.slug}`,
        name: entry.name,
        publication: entry,
        binding: "pending",
        owner: "Unknown",
        nextAction: "Review canonical identity and reconcile interaction evidence",
        followUp: null,
        messages: [],
      });
  }
  for (const item of history?.interactions ?? []) {
    // These two case aliases are explicit source-to-public mappings, never CMD identity bindings.
    const slug =
      ({ Sase: "sase", SBRC: "sbrc" } as Record<string, string>)[item.client_slug] ??
      item.client_slug;
    let target = records.find(
      (r) => r.review?.roadmap_slug === slug || r.publication?.slug === slug,
    );
    if (!target) {
      target = {
        key: `history:${item.client_slug}`,
        name: item.client_slug,
        binding: "pending",
        owner: "Unknown",
        nextAction: "Review source identity before linking to CMD",
        followUp: null,
        messages: [],
      };
      records.push(target);
    }
    const incoming: MessageEvidence = {
      type:
        item.direction === "sent"
          ? "email_sent"
          : item.direction === "team_outbound_copy"
            ? "email_team_outbound_copy"
            : "email_received",
      from: extractAddresses(item.from)[0] ?? item.account,
      to: extractAddresses(item.to),
      from_header: item.from,
      to_header: item.to,
      cc_header: item.cc,
      content_safety: item.content_safety,
      subject: item.subject,
      sent_at: item.date_utc,
      provider: "gmail",
      mailbox: item.account,
      provider_message_id: item.message_id,
      provider_thread_id: item.thread_id,
      source_url: item.source_url,
      verification: "Reviewed mailbox evidence · partial historical coverage",
      body_exact: item.body_text,
      body_format: "text/plain",
    };
    const existing = target.messages.find(
      (m) =>
        m.message.provider === "gmail" &&
        m.message.provider_message_id === item.message_id &&
        m.mailboxes.includes(item.account),
    );
    if (
      existing &&
      existing.message.type === incoming.type &&
      Date.parse(existing.message.sent_at) === Date.parse(incoming.sent_at) &&
      existing.message.subject === incoming.subject &&
      existing.message.from === incoming.from &&
      JSON.stringify([...existing.message.to].sort()) === JSON.stringify([...incoming.to].sort())
    ) {
      existing.sources = [...new Set([...existing.sources, item.source_url])];
      if (existing.message.body_exact !== incoming.body_exact) {
        if (existing.message.body_format !== "text/html") {
          existing.conflict = true;
          target.messages.push({
            message: incoming,
            sources: [item.source_url],
            mailboxes: [item.account],
            conflict: true,
          });
          continue;
        }

        // The historic source is an explicitly sanitized text representation, not another delivery.
        existing.alternateText = [
          ...(existing.alternateText ?? []),
          { text: item.body_text, source: item.source_url, note: item.content_safety },
        ];
      }
    } else if (existing) {
      existing.conflict = true;
      target.messages.push({
        message: incoming,
        sources: [item.source_url],
        mailboxes: [item.account],
        conflict: true,
      });
    } else
      target.messages.push({
        message: incoming,
        sources: [item.source_url],
        mailboxes: [item.account],
        conflict: false,
      });
    target.messages.sort((a, b) => Date.parse(b.message.sent_at) - Date.parse(a.message.sent_at));
  }
  for (const row of coverage?.rows ?? []) {
    const record = records.find(
      (r) =>
        (r.publication?.slug ?? r.review?.roadmap_slug) === row.slug &&
        (r.publication?.url ?? r.review?.public_roadmap_url) === row.url,
    );
    if (record) record.coverage = row;
  }
  return records;
}
export function observedSends(record: EvidenceRecord): number {
  return record.messages.filter((m) => !m.conflict && m.message.type === "email_sent").length;
}
export function canonicalOutreachHolds(record: EvidenceRecord): { kind: string; source: string }[] {
  const holds = record.native?.metadata["outreach_holds"];
  if (!Array.isArray(holds)) return [];
  return holds.filter((h): h is { kind: string; source: string; outreach_suppressed: true } =>
    Boolean(
      h &&
      typeof h === "object" &&
      h.outreach_suppressed === true &&
      typeof h.kind === "string" &&
      typeof h.source === "string",
    ),
  );
}
export function evidenceHolds(record: EvidenceRecord): string[] {
  return [
    ...canonicalOutreachHolds(record).map((h) =>
      h.kind === "declined"
        ? "Declined · outreach suppressed; retain history only."
        : h.kind === "permanent_email_bounce"
          ? "Permanent email bounce · outreach held until corrected contact and separate approval."
          : "Canonical outreach hold · review before any action.",
    ),
    ...deliveryFailures(record).map(
      (f) =>
        `Permanent delivery failure ${f.smtp_status}: ${f.reason}. Do not resend without corrected contact and separate approval.`,
    ),
    ...(record.binding === "pending" ? ["Canonical identity needs review"] : []),
    ...(record.publication?.identityHold ? [record.publication.identityHold] : []),
    ...(record.review?.recipient.verification_status === "held_unverified_named_direct"
      ? [record.review.recipient.disposition]
      : []),
    ...(!observedSends(record) && record.review?.prepared_message?.footer_status
      ? [record.review.prepared_message.footer_status]
      : []),
    ...(record.messages.some((m) => m.conflict)
      ? ["Message evidence conflicts · excluded from verified sends"]
      : []),
  ];
}

/** Text-only presentation. Output must remain a React text node, never HTML. Original is retained. */
export function messagePlainText(body: string, format: MessageEvidence["body_format"]): string {
  if (format === "text/plain") return body;
  return body
    .replace(/<(script|style|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<a\b[^>]*href=["'](https:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(?:amp|lt|gt|quot|apos|nbsp);/g,
      (e) =>
        ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[
          e
        ] ?? e,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, code: string) => {
      const n = code[0]?.toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function deliveryFailures(record: EvidenceRecord) {
  return (
    record.review?.interactions.filter(
      (m): m is z.infer<typeof deliveryFailure> => m.type === "email_delivery_failed",
    ) ?? []
  );
}
export function savedDrafts(record: EvidenceRecord) {
  if (record.review?.outreach_status.mailbox_draft_saved === false) return [];
  const sentDraftIds = new Set(
    record.messages
      .filter((m) => m.message.type === "email_sent")
      .map((m) => m.message.provider_draft_id),
  );
  const drafts = new Map<string, z.infer<typeof draftReceipt>>();
  for (const item of record.review?.interactions ?? []) {
    if (item.type !== "email_draft_saved" && item.type !== "email_draft_state_verified") continue;
    if (sentDraftIds.has(item.provider_draft_id)) continue;
    const normalized =
      item.type === "email_draft_saved"
        ? item
        : {
            ...item,
            type: "email_draft_saved" as const,
            sent_at: null,
            body_plain_text_content_only: messagePlainText(item.body_exact, item.body_format),
            saved_message_timestamp: item.message_timestamp,
            verification: `Mailbox DRAFT state verified at ${item.verified_at}`,
          };
    const before = drafts.get(item.provider_draft_id);
    if (!before || Date.parse(normalized.verified_at) >= Date.parse(before.verified_at))
      drafts.set(item.provider_draft_id, normalized);
  }
  return [...drafts.values()];
}

const extractAddresses = (header: string) =>
  header.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
export const partialInteractionSchema = z.object({
  status: z.literal("partial_known_client_interactions"),
  coverage: z.string().min(1),
  interactions: z.array(
    z.object({
      client_slug: z.string().regex(/^[A-Za-z0-9-]+$/),
      account: z.string().email(),
      message_id: z.string().min(1),
      thread_id: z.string().min(1),
      direction: z.enum(["sent", "received", "team_outbound_copy"]),
      date_utc: timestamp,
      from: z.string(),
      to: z.string(),
      cc: z.string(),
      subject: z.string(),
      body_text: z.string(),
      source_url: sourceUrl,
      content_safety: z.string().min(1),
    }),
  ),
});
export type PartialInteractionHistory = z.infer<typeof partialInteractionSchema>;

export const partialCoverageSchema = z.object({
  status: z.literal("partial_reconciliation"),
  rows: z.array(
    z.object({
      slug: z.string(),
      url: sourceUrl,
      status: z.enum([
        "published_send_unverified",
        "verified_roadmap_sent",
        "mailbox_draft_for_review",
        "mailbox_draft_warm_revision_saved",
        "verified_roadmap_sent_permanent_bounce",
        "team_outbound_roadmap_copy",
        "intro_sent_roadmap_send_unverified",
        "existing_client_history_roadmap_send_unverified",
      ]),
      gmail_history_complete: z.literal(false),
      coverage_note: z.string(),
      separate_user_evidenced_interaction: z
        .object({
          evidence_class: z.literal(
            "user_provided_screenshot_reported_by_parent_not_connector_verified",
          ),
          library_file_id: z.string(),
          sender_context: z.string(),
          sent_at_reported: timestamp,
          reply_at_reported: timestamp,
          reply_summary: z.string(),
          limits: z.string(),
        })
        .optional(),
      verified_sent_message_ids: z.array(z.string()),
      publication_checked_at: timestamp,
    }),
  ),
});
export type PartialCoverage = z.infer<typeof partialCoverageSchema>;
export function roadmapSendVerified(record: EvidenceRecord): boolean {
  return (
    ["verified_roadmap_sent", "verified_roadmap_sent_permanent_bounce"].includes(
      record.coverage?.status ?? "",
    ) &&
    record.messages.some(
      (m) =>
        !m.conflict &&
        m.message.type === "email_sent" &&
        record.coverage!.verified_sent_message_ids.includes(m.message.provider_message_id),
    )
  );
}
