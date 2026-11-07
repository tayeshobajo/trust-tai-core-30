import type { ResearchResult } from "./studio-research";
export type ManualStatus =
  | "queued"
  | "started"
  | "ready"
  | "failed"
  | "delivery_uncertain"
  | "uncertain"
  | "result_acceptance_blocked"
  | "stopped"
  | "reviewed";
export type ManualBrief = {
  research: ResearchResult;
  people: { name: string; relevance: string; quote: string; sourceUrl: string }[];
  draft: null;
};
export type ManualView = {
  requestId: string;
  status: ManualStatus;
  executionStop: "unverified" | "confirmed";
  brief?: ManualBrief;
  decision?: "use" | "edit" | "save" | "skip";
};
export type ManualCommand = {
  organizationId: string;
  requestId: string;
  topic: string;
  approvedUrls: string[];
};
export type ManualResearchAdapter = {
  mode: "local-fixture" | "live";
  approve(command: ManualCommand): Promise<ManualView>;
  start(id: string): Promise<ManualView>;
  read(id: string): Promise<ManualView>;
  reconcile?(id: string): Promise<ManualView>;
  cancel(id: string): Promise<ManualView>;
  review(
    id: string,
    decision: "use" | "edit" | "save" | "skip",
    editedText?: string,
  ): Promise<ManualView>;
};
export function manualSourceUrls(value: string) {
  const lines = value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 3)
    throw Error("Add one to three public HTTPS URLs, one per line.");
  const urls = lines.map((line) => {
    let u: URL;
    try {
      u = new URL(line);
    } catch {
      throw Error("Each source needs a complete HTTPS URL.");
    }
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.port ||
      u.hostname === "localhost" ||
      u.hostname.endsWith(".local") ||
      u.hostname.includes(":") ||
      /^\d+(\.\d+)*$/.test(u.hostname)
    )
      throw Error("Use public HTTPS URLs without sign-in details, query strings or fragments.");
    return u.href;
  });
  if (new Set(urls).size !== urls.length) throw Error("Each approved source must be different.");
  return urls;
}
export function manualStatusLabel(view: ManualView) {
  switch (view.status) {
    case "queued":
      return "Queued · not started";
    case "started":
      return "Started · awaiting a brief";
    case "ready":
      return "Ready for your review";
    case "failed":
      return "Failed · review this request before trying another";
    case "delivery_uncertain":
      return "Brief delivery unconfirmed · reconcile without rerunning research";
    case "uncertain":
      return "Outcome uncertain · do not start this request again";
    case "result_acceptance_blocked":
      return "Result acceptance blocked · execution stop is unverified";
    case "stopped":
      return view.executionStop === "confirmed"
        ? "Execution stop confirmed"
        : "Stop requested · execution stop is unverified";
    case "reviewed":
      return "Review choice recorded";
  }
}
/** Explicit opt-in fictional example, in-memory only. No browser storage, network or model. */
export function createManualResearchFixture(): ManualResearchAdapter {
  const records = new Map<string, ManualView>();
  const commands = new Map<string, ManualCommand>();
  const get = (id: string) => {
    const row = records.get(id);
    if (!row) throw Error("Missing local example");
    return structuredClone(row);
  };
  return {
    mode: "local-fixture",
    async approve(command) {
      if (records.has(command.requestId)) return get(command.requestId);
      commands.set(command.requestId, structuredClone(command));
      const v: ManualView = {
        requestId: command.requestId,
        status: "queued",
        executionStop: "unverified",
      };
      records.set(v.requestId, v);
      return get(v.requestId);
    },
    async start(id) {
      const v = get(id);
      if (v.status === "queued") {
        v.status = "started";
        records.set(id, v);
      }
      return get(id);
    },
    async read(id) {
      const v = get(id);
      if (v.status === "started") {
        const c = commands.get(id)!;
        v.status = "ready";
        v.brief = {
          research: {
            version: 1,
            requestId: id,
            topics: [
              {
                title: "A practical AI handoff",
                summary:
                  "Fictional example: show where human review belongs in a small business workflow.",
                relevance: "A possible topic for reviewing the research experience.",
                sources: [
                  {
                    url: c.approvedUrls[0]!,
                    title: "Example source · not fetched",
                    publishedAt: null,
                    retrievedAt: "2026-11-06T00:00:00Z",
                  },
                ],
              },
            ],
            limitations: [
              "Fictional local fixture. No source was fetched or verified. No people were discovered.",
            ],
          },
          people: [],
          draft: null,
        };
        records.set(id, v);
      }
      return get(id);
    },
    async cancel(id) {
      const v = get(id);
      v.status = "result_acceptance_blocked";
      records.set(id, v);
      return get(id);
    },
    async review(id, decision) {
      const v = get(id);
      if (v.status !== "ready") throw Error("Review is not ready");
      v.status = "reviewed";
      v.decision = decision;
      records.set(id, v);
      return get(id);
    },
  };
}
