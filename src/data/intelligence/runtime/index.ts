/**
 * The Trust Tai Intelligence Runtime.
 *
 * One reasoning gateway, one retrieval composition, one capability view, one
 * problem-solving protocol, one completion gate — for every room in the
 * suite. Rooms adopt the runtime; they never build their own AI stack.
 *
 * - retrieval.ts: what the runtime knows before it reasons.
 * - reason.ts: the read, verified against the packet that produced it.
 * - protocol.ts: the bounded diagnostic loop after a failed attempt.
 * - verification.ts: "done" requires proof; "the action ran" is not proof.
 * - manifest.ts: per-room readiness, code-backed and honest.
 *
 * The single provider boundary lives in src/lib/intelligence-runtime.server.ts.
 */

export * from "./retrieval";
export * from "./reason";
export * from "./protocol";
export * from "./verification";
export * from "./manifest";
export * from "./prior-cases";
