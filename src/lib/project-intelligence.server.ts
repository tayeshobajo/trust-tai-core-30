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
