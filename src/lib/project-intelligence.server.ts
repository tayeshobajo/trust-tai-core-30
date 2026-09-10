/**
 * Ask this project.
 *
 * Chat is how a person talks to one project. Projects remains where project
 * truth lives, so this reasons over the project's own context packet and the
 * context a person pastes in for this turn, and it writes nothing. Every
 * consequential change still goes through the Projects services, their
 * permissions and their human gates.
 *
 * There is no separate project brain: the call goes through the shared
 * Intelligence Runtime boundary, which verifies access before a provider is
 * ever reached.
 */

import {
  extractJsonObject,
  runtimeModelCaller,
  type RuntimeModelCaller,
} from "@/lib/intelligence-runtime.server";

export interface ProjectAskInput {
  token: string;
  organizationId: string;
  projectLabel: string;
  question: string;
  /** The authorized project packet, already read under the caller's session. */
  packet: unknown;
  /** Anything the person pasted for this turn only. Never stored by this call. */
  pasted?: string;
  gateway?: Parameters<RuntimeModelCaller>[0]["gateway"];
}

export interface ProjectAskResult {
  answer: string;
  /** Statements the packet actually supports. */
  facts: string[];
  /** Reading laid on top of those facts, kept separate from them. */
  interpretations: string[];
  /** What the project record does not answer. Never filled with a guess. */
  unknowns: string[];
  /** What a person could do next, in Projects. Nothing is done by this call. */
  nextSteps: string[];
}

const VOICE = [
  "Write to the operator, plainly, in short sentences.",
  "Never describe your own reasoning process or narrate your steps.",
  "Never claim anything was saved, changed, assigned or sent. You cannot write.",
].join(" ");

function lines(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0)
    : [];
}

/** Answer once, after the runtime boundary has cleared access. */
export async function answerProjectQuestion(
  input: Omit<ProjectAskInput, "token" | "organizationId">,
  callModel: RuntimeModelCaller,
): Promise<ProjectAskResult> {
  const question = input.question.trim();
  if (!question) throw new Error("A question is required.");

  const { raw } = await callModel({
    instructions: [
      "You answer questions about one delivery project and you return json.",
      "Use only the project record provided and anything the person pasted in this turn.",
      "Do not search the web and do not invent project facts.",
      "Anything the record does not answer goes in unknowns.",
      "next_steps may only name actions a person takes in Projects. You never take them.",
      VOICE,
    ].join(" "),
    input: JSON.stringify({
      project: input.projectLabel,
      question,
      project_record: input.packet,
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
export async function askProject(input: ProjectAskInput): Promise<ProjectAskResult> {
  let callModel: RuntimeModelCaller;
  try {
    callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: input.organizationId,
      room: "projects",
      purpose: "research",
    });
  } catch {
    throw new Error("You do not have access to this workspace.");
  }
  return answerProjectQuestion(input, callModel);
}

/* ------------------------------------------------------------ preparing a change */

export interface ProjectIntentResult {
  /** What the message was: a question, a change to prepare, or another room's truth. */
  kind: "question" | "change" | "other_room" | "unclear";
  /** Present when kind is "change". Bounded to project-owned actions. */
  action?: string;
  value?: string;
  items?: string[];
  source?: { title?: string; url?: string; sourceType?: string };
  reason?: string;
  /** Present when kind is "other_room". */
  room?: string;
  /** Plain words for the person, always. */
  because: string;
}

const CHAT_ACTIONS = [
  "name",
  "point_a",
  "point_b",
  "due_date",
  "owner",
  "next_move",
  "waiting_on",
  "block",
  "delivery_items",
  "link_source",
] as const;

const OTHER_ROOMS = ["clients", "roadmap", "comms", "commercial"] as const;

/**
 * Read one message and say what it is asking for. This never writes and never
 * decides: it names a bounded project-owned action, or names the room that
 * owns the truth instead, and a person still has to approve.
 */
export async function interpretProjectMessage(
  input: {
    projectLabel: string;
    message: string;
    packet: unknown;
    members?: string[];
  },
  callModel: RuntimeModelCaller,
): Promise<ProjectIntentResult> {
  const message = input.message.trim();
  if (!message) throw new Error("A message is required.");

  const { raw } = await callModel({
    instructions: [
      "You read one message about one delivery project and you return json.",
      "Decide the kind: question, change, other_room, or unclear.",
      `A change may only name one of these actions: ${CHAT_ACTIONS.join(", ")}.`,
      "Projects does not own client reassignment, roadmap lineage, commercial tier, proposal amounts or sending messages.",
      `If the message asks for one of those, kind is other_room and room is one of: ${OTHER_ROOMS.join(", ")}.`,
      "due_date value is a calendar day as YYYY-MM-DD. owner value is the person's name exactly as written.",
      "delivery_items returns the full intended list in items. link_source returns source.title, source.url and source.sourceType.",
      "Never invent a value the message did not give. If it is not clear, kind is unclear and because says what is missing.",
      VOICE,
    ].join(" "),
    input: JSON.stringify({
      project: input.projectLabel,
      message,
      project_record: input.packet,
      workspace_members: input.members ?? [],
      json_shape: {
        kind: "change",
        action: "next_move",
        value: "",
        items: [""],
        source: { title: "", url: "", sourceType: "other" },
        reason: "",
        room: "",
        because: "",
      },
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
  const kind = (["question", "change", "other_room", "unclear"] as string[]).includes(kindRaw)
    ? (kindRaw as ProjectIntentResult["kind"])
    : "unclear";
  const action = String(parsed["action"] ?? "").trim();
  const room = String(parsed["room"] ?? "").trim();

  const result: ProjectIntentResult = {
    kind,
    because: String(parsed["because"] ?? "").trim(),
  };
  if (kind === "change") {
    if (!(CHAT_ACTIONS as readonly string[]).includes(action)) {
      return {
        kind: "unclear",
        because:
          result.because || "That is not a change Projects can make from here. Say it another way.",
      };
    }
    result.action = action;
    const value = String(parsed["value"] ?? "").trim();
    if (value) result.value = value;
    const items = lines(parsed["items"]);
    if (items.length > 0) result.items = items;
    const source = parsed["source"];
    if (source && typeof source === "object") {
      const row = source as Record<string, unknown>;
      result.source = {
        title: String(row["title"] ?? "").trim(),
        url: String(row["url"] ?? "").trim(),
        sourceType: String(row["sourceType"] ?? "other").trim(),
      };
    }
    const reason = String(parsed["reason"] ?? "").trim();
    if (reason) result.reason = reason;
  }
  if (kind === "other_room" && (OTHER_ROOMS as readonly string[]).includes(room)) {
    result.room = room;
  }
  return result;
}

/** Verify access at the shared boundary, then read the message. Fails closed. */
export async function readProjectMessage(
  input: Omit<ProjectAskInput, "question" | "pasted"> & { message: string; members?: string[] },
): Promise<ProjectIntentResult> {
  let callModel: RuntimeModelCaller;
  try {
    callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: input.organizationId,
      room: "projects",
      purpose: "research",
    });
  } catch {
    throw new Error("You do not have access to this workspace.");
  }
  const gatewayCaller: RuntimeModelCaller = (request) =>
    callModel({ ...request, ...(input.gateway ? { gateway: input.gateway } : {}) });
  return interpretProjectMessage(
    {
      projectLabel: input.projectLabel,
      message: input.message,
      packet: input.packet,
      ...(input.members ? { members: input.members } : {}),
    },
    gatewayCaller,
  );
}
