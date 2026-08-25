import { describe, expect, it } from "vitest";

import {
  MAX_INTAKE_EXCEPTIONS,
  intakeExceptionToJson,
  isMachineAddress,
  mergeIntakeExceptions,
  readIntakeExceptions,
  resolveIntakeCounterpart,
  type IntakeException,
  type IntakeMessageLike,
} from "@/domain/comms-intake";

const BOX = "tai@trusttai.com";

function message(overrides: Partial<IntakeMessageLike>): IntakeMessageLike {
  return {
    providerMessageId: "m1",
    providerThreadId: "t1",
    direction: "inbound",
    toEmails: [BOX],
    ccEmails: [],
    occurredAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

describe("resolveIntakeCounterpart", () => {
  it("takes the sender of labeled inbound mail as the person the label approved", () => {
    expect(
      resolveIntakeCounterpart(
        message({ fromEmail: "Claire@Dozen.com", fromName: "Claire Meneely" }),
        BOX,
      ),
    ).toEqual({ kind: "person", email: "claire@dozen.com", name: "Claire Meneely" });
  });

  it("takes the single recipient of labeled outbound mail", () => {
    expect(
      resolveIntakeCounterpart(
        message({ direction: "outbound", fromEmail: BOX, toEmails: ["sara@warren.co"] }),
        BOX,
      ),
    ).toEqual({ kind: "person", email: "sara@warren.co" });
  });

  it("refuses to guess on a multi-party labeled thread", () => {
    const result = resolveIntakeCounterpart(
      message({
        direction: "outbound",
        fromEmail: BOX,
        toEmails: ["sara@warren.co", "ben@warren.co"],
      }),
      BOX,
    );
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.emails).toEqual([
      "sara@warren.co",
      "ben@warren.co",
    ]);
  });

  it("never treats a machine address as a relationship", () => {
    expect(isMachineAddress("no-reply@stripe.com")).toBe(true);
    expect(resolveIntakeCounterpart(message({ fromEmail: "no-reply@stripe.com" }), BOX)).toEqual({
      kind: "none",
    });
  });

  it("ignores the mailbox itself when reading recipients", () => {
    expect(
      resolveIntakeCounterpart(
        message({ direction: "outbound", fromEmail: BOX, toEmails: [BOX, "sara@warren.co"] }),
        BOX,
      ),
    ).toEqual({ kind: "person", email: "sara@warren.co" });
  });
});

describe("intake exception queue", () => {
  function exception(overrides: Partial<IntakeException> = {}): IntakeException {
    return {
      reason: "ambiguous_thread",
      providerMessageId: "m1",
      providerThreadId: "t1",
      emails: ["a@b.com"],
      occurredAt: "2026-08-22T10:00:00.000Z",
      observedAt: "2026-08-22T11:00:00.000Z",
      retryable: false,
      ...overrides,
    };
  }

  it("round-trips through the cursor shape", () => {
    const entry = exception({ subject: "Intro", detail: "two people" });
    const read = readIntakeExceptions({ intake_exceptions: [intakeExceptionToJson(entry)] });
    expect(read).toEqual([entry]);
  });

  it("reads nothing from an absent or malformed cursor", () => {
    expect(readIntakeExceptions({})).toEqual([]);
    expect(readIntakeExceptions({ intake_exceptions: "nope" })).toEqual([]);
    expect(readIntakeExceptions({ intake_exceptions: [{ reason: "other" }] })).toEqual([]);
  });

  it("does not grow on a repeated sync of the same message", () => {
    const first = mergeIntakeExceptions([], [exception()]);
    const second = mergeIntakeExceptions(first, [exception({ observedAt: "2026-08-22T12:00" })]);
    expect(second).toHaveLength(1);
    expect(second[0]!.observedAt).toBe("2026-08-22T12:00");
  });

  it("drops a message whose person came into Comms this pass", () => {
    const merged = mergeIntakeExceptions([exception()], [], new Set(["m1"]));
    expect(merged).toEqual([]);
  });

  it("stays bounded", () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      exception({ providerMessageId: `m${index}` }),
    );
    expect(mergeIntakeExceptions([], many)).toHaveLength(MAX_INTAKE_EXCEPTIONS);
  });
});
