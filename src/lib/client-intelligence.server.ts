/**
 * Ask this account.
 *
 * Client Chat is how a person talks to one company. Clients remains where
 * account truth is composed and the owning services remain where it is
 * written, so this reasons over a bounded client context packet and writes
 * nothing at all.
 *
 * There is no separate client brain: the call goes through the shared
 * Intelligence Runtime boundary, which verifies access before a provider is
 * ever reached.
 */

import {
  extractJsonObject,
  runtimeModelCaller,
  type RuntimeModelCaller,
} from "@/lib/intelligence-runtime.server";

export interface ClientAskInput {
  token: string;
  organizationId: string;
  clientLabel: string;
  question: string;
  /** The bounded account packet, composed from reads made under this session. */
  packet: unknown;
  /** Anything the person pasted for this turn only. Never stored by this call. */
  pasted?: string;
  gateway?: Parameters<RuntimeModelCaller>[0]["gateway"];
}

export interface ClientAskResult {
  answer: string;
  facts: string[];
  interpretations: string[];
  unknowns: string[];
  nextSteps: string[];
}

const VOICE = [
  "Write to the operator, plainly, in short sentences.",
  "Never describe your own reasoning process or narrate your steps.",
  "Never claim anything was saved, changed, sent or assigned. You cannot write.",
].join(" ");

function lines(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0)
    : [];
}

/** Answer once, after the runtime boundary has cleared access. */
export async function answerClientQuestion(
  input: Omit<ClientAskInput, "token" | "organizationId">,
  callModel: RuntimeModelCaller,
): Promise<ClientAskResult> {
  const question = input.question.trim();
  if (!question) throw new Error("A question is required.");

  const { raw } = await callModel({
    instructions: [
      "You answer questions about one client account and you return json.",
      "Use only the account packet provided and anything the person pasted in this turn.",
      "Do not search the web and do not invent account facts.",
      "A section marked unreadable could not be read. Say that; never call it an absence.",
      "Project execution belongs to the project workspace. Answer from the project summaries and point there for deeper work.",
      "Messages belong to Comms. Never draft a send as if it will happen.",
      "next_steps may only name actions a person takes themselves. You never take them.",
      VOICE,
    ].join(" "),
    input: JSON.stringify({
      client: input.clientLabel,
      question,
      account_packet: input.packet,
      pasted_this_turn: input.pasted?.trim() || null,
      json_shape: {
        answer: "",
        facts: [""],
        interpretations: [""],
        unknowns: [""],
        next_steps: [""],
      },
    }),
    webSearch: false,
    ...(input.gateway ? { gateway: input.gateway } : {}),
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    throw new Error("That answer could not be read. Nothing was changed.");
  }

  return {
    answer: String(parsed["answer"] ?? "").trim(),
    facts: lines(parsed["facts"]),
    interpretations: lines(parsed["interpretations"]),
    unknowns: lines(parsed["unknowns"]),
    nextSteps: lines(parsed["next_steps"] ?? parsed["nextSteps"]),
  };
}

/** Verify access at the shared boundary, then answer. Fails closed. */
export async function askClient(input: ClientAskInput): Promise<ClientAskResult> {
  let callModel: RuntimeModelCaller;
  try {
    callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: input.organizationId,
      room: "clients",
      purpose: "research",
    });
  } catch {
    throw new Error("You do not have access to this workspace.");
  }
  return answerClientQuestion(input, callModel);
}

/* ------------------------------------------------------ preparing a change */

export interface ClientIntentResult {
  /** What the message was: a question, a change to prepare, or another room's truth. */
  kind: "question" | "change" | "other_room" | "unclear";
  /** Present when kind is "change". Bounded to account-owned commercial fields. */
  action?: string;
  value?: string;
  reason?: string;
  /** Present when kind is "other_room". */
  room?: string;
  /** Plain words for the person, always. */
  because: string;
}

const CLIENT_ACTIONS = ["mrr", "renewal_date", "next_review_date"] as const;
const OTHER_ROOMS = ["projects", "roadmap", "comms", "website", "commercial_panel"] as const;

/**
 * Read one message and say what it is asking for. This never writes and never
 * decides: it names a bounded account-owned action, or names the room that
 * owns the truth instead, and a person still has to approve.
 */
export async function interpretClientMessage(
  input: { clientLabel: string; message: string; packet: unknown },
  callModel: RuntimeModelCaller,
): Promise<ClientIntentResult> {
  const message = input.message.trim();
  if (!message) throw new Error("A message is required.");

  const { raw } = await callModel({
    instructions: [
      "You read one message about one client account and you return json.",
      "Decide the kind: question, change, other_room, or unclear.",
      `A change may only name one of these actions: ${CLIENT_ACTIONS.join(", ")}.`,
      "The account does not own project execution, roadmap lineage, sending messages, site operations, or a tier move.",
      `If the message asks for one of those, kind is other_room and room is one of: ${OTHER_ROOMS.join(", ")}.`,
      "A tier move is always room commercial_panel, because it can recognise revenue.",
      "value for a date is YYYY-MM-DD. value for mrr is the plain monthly number.",
      "reason must be the person's own words for why. If they gave none, kind is unclear.",
      VOICE,
    ].join(" "),
    input: JSON.stringify({
      client: input.clientLabel,
      message,
      account_packet: input.packet,
      json_shape: { kind: "", action: "", value: "", reason: "", room: "", because: "" },
    }),
    webSearch: false,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(raw);
  } catch {
    throw new Error("That message could not be read. Nothing was changed.");
  }

  const kindRaw = String(parsed["kind"] ?? "").trim();
  const kind: ClientIntentResult["kind"] =
    kindRaw === "question" || kindRaw === "change" || kindRaw === "other_room"
      ? kindRaw
      : "unclear";
  const action = String(parsed["action"] ?? "").trim();
  const room = String(parsed["room"] ?? "").trim();

  return {
    kind,
    ...(kind === "change" && (CLIENT_ACTIONS as readonly string[]).includes(action)
      ? { action }
      : {}),
    ...(parsed["value"] !== undefined ? { value: String(parsed["value"] ?? "").trim() } : {}),
    ...(parsed["reason"] !== undefined ? { reason: String(parsed["reason"] ?? "").trim() } : {}),
    ...(kind === "other_room" && (OTHER_ROOMS as readonly string[]).includes(room) ? { room } : {}),
    because: String(parsed["because"] ?? "").trim(),
  };
}

/** Verify access at the shared boundary, then read the message. Fails closed. */
export async function readClientMessage(input: {
  token: string;
  organizationId: string;
  clientLabel: string;
  message: string;
  packet: unknown;
  gateway?: Parameters<RuntimeModelCaller>[0]["gateway"];
}): Promise<ClientIntentResult> {
  let callModel: RuntimeModelCaller;
  try {
    callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: input.organizationId,
      room: "clients",
      purpose: "research",
    });
  } catch {
    throw new Error("You do not have access to this workspace.");
  }
  return interpretClientMessage(input, callModel);
}
