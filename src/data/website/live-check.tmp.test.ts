import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env["TRUST_TAI_SUPABASE_URL"]!;
const key = process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"]!;
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("apikey", key);
      headers.set("Authorization", `Bearer ${key}`);
      return fetch(input as RequestInfo, { ...init, headers });
    },
  },
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: admin }));
vi.mock("@/integrations/trust-tai/supabase", () => ({ supabase: admin, trustTaiSupabase: admin }));

const ORG = "ee683a64-e045-4226-a8ff-4ae6590d6789";

describe("live website acceptance", () => {
  it("derives", async () => {
    const { listWebsiteSubmissions } = await import("@/data/supabase/website-service");
    const { scoutService } = await import("@/data/supabase/scout-service");
    const { websiteSignals, websiteContextBlocks, inboundBrief } = await import(
      "@/data/website/intel"
    );

    const probe = await admin.from("website_intake_submissions").select("id").limit(1);
    console.log("PROBE", JSON.stringify(probe.error ?? probe.data));
    const mod = await import("@/integrations/supabase/client");
    console.log("MOCKED", mod.supabase === admin);
    const subs = await listWebsiteSubmissions(ORG);
    const candidates = await scoutService.list(ORG);
    const now = new Date().toISOString();
    const input = { organizationId: ORG, now, submissions: subs.value, candidates };

    console.log("SUBMISSIONS", subs.value.length, subs.value.map((s) => s.submissionId));
    const sub = subs.value[0]!;
    console.log("SUB_SUMMARY", JSON.stringify({
      id: sub.id,
      submissionId: sub.submissionId,
      linkState: sub.linkState,
      linkReason: sub.linkReason,
      scoutProspectId: sub.scoutProspectId,
      scoutStatus: sub.scoutStatus,
      verbatim: sub.verbatim.length,
      signals: sub.signals,
    }, null, 1));

    const cand = candidates.find((c) => c.prospect.id === sub.scoutProspectId);
    console.log("CANDIDATE", JSON.stringify({
      id: cand?.prospect.id,
      name: cand?.prospect.name,
      status: cand?.prospect.status,
      observed: cand?.prospect.observed?.length,
      statedClaims: cand?.stated?.claims?.length,
      fit: cand?.evaluation?.score,
    }, null, 1));

    console.log("SIGNALS", JSON.stringify(websiteSignals(input), null, 1));
    console.log("BLOCKS", JSON.stringify(websiteContextBlocks(input).map((b) => ({
      id: b.id, lane: (b as Record<string, unknown>)["lane"] ?? (b as Record<string, unknown>)["kind"], headline: (b as Record<string, unknown>)["headline"] ?? (b as Record<string, unknown>)["summary"],
    })), null, 1));
    console.log("BRIEF", JSON.stringify(inboundBrief(input), null, 1).slice(0, 4000));

    expect(subs.value.length).toBeGreaterThan(0);
  }, 60000);
});
