import { describe, expect, it } from "vitest";

import {
  buildMimeMessage,
  deterministicMessageId,
  encodeRawEmail,
  formatBytes,
  gmailComposeUrl,
  MAX_ATTACHMENT_BYTES,
  parseRecipients,
  replyRecipients,
  replySubject,
  validateAttachments,
} from "./comms-mime";

describe("validateAttachments", () => {
  it("passes a small ordinary file", () => {
    expect(validateAttachments([{ filename: "brief.pdf", size: 100_000 }])).toEqual([]);
  });

  it("names the blocked extension, not just an error", () => {
    const errors = validateAttachments([{ filename: "setup.exe", size: 100 }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("setup.exe");
    expect(errors[0]).toContain(".exe");
  });

  it("names the file that is too large", () => {
    const errors = validateAttachments([
      { filename: "huge.zip", size: MAX_ATTACHMENT_BYTES + 1 },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("huge.zip");
  });

  it("caps the total a message can carry", () => {
    const nineMb = 9 * 1024 * 1024;
    const errors = validateAttachments([
      { filename: "a.pdf", size: nineMb },
      { filename: "b.pdf", size: nineMb },
      { filename: "c.pdf", size: nineMb },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Together");
  });

  it("accepts a set just under the total", () => {
    const nineMb = 9 * 1024 * 1024;
    expect(
      validateAttachments([
        { filename: "a.pdf", size: nineMb },
        { filename: "b.pdf", size: nineMb },
      ]),
    ).toEqual([]);
  });
});

describe("parseRecipients", () => {
  it("splits commas and semicolons, lowercases, dedupes", () => {
    expect(parseRecipients("Dana@X.com, lee@y.com; dana@x.com")).toEqual([
      "dana@x.com",
      "lee@y.com",
    ]);
  });

  it("drops entries that are not addresses", () => {
    expect(parseRecipients("not-an-email, sam@z.com")).toEqual(["sam@z.com"]);
    expect(parseRecipients("")).toEqual([]);
  });
});

describe("replyRecipients", () => {
  it("never sends back to our own mailbox, whoever the headers list", () => {
    const result = replyRecipients({
      replyTo: "dana@x.com",
      toEmails: ["tai@trust-tai.com", "lee@y.com"],
      ccEmails: ["sam@z.com", "dana@x.com"],
      mailbox: "tai@trust-tai.com",
    });
    expect(result.to).toEqual(["dana@x.com"]);
    expect(result.cc).toEqual(["lee@y.com", "sam@z.com"]);
    expect([...result.to, ...result.cc]).not.toContain("tai@trust-tai.com");
  });

  it("keeps the person we answer in To, everyone else in Cc, once", () => {
    const result = replyRecipients({
      replyTo: "dana@x.com",
      toEmails: ["dana@x.com", "tai@trust-tai.com"],
      ccEmails: [],
      mailbox: "tai@trust-tai.com",
    });
    expect(result.to).toEqual(["dana@x.com"]);
    expect(result.cc).toEqual([]);
  });

  it("answers nothing when the only participant is us", () => {
    const result = replyRecipients({
      replyTo: "tai@trust-tai.com",
      toEmails: ["tai@trust-tai.com"],
      ccEmails: [],
      mailbox: "tai@trust-tai.com",
    });
    expect(result.to).toEqual([]);
    expect(result.cc).toEqual([]);
  });
});

describe("replySubject", () => {
  it("adds Re: exactly once", () => {
    expect(replySubject("Following up on Nashville")).toBe("Re: Following up on Nashville");
    expect(replySubject("Re: Following up on Nashville")).toBe("Re: Following up on Nashville");
    expect(replySubject("Re: Fwd: Following up")).toBe("Re: Following up");
  });

  it("stays empty when there is nothing to answer", () => {
    expect(replySubject(undefined)).toBe("");
    expect(replySubject("  ")).toBe("");
  });
});

describe("deterministicMessageId", () => {
  it("is stable per draft — a retried send is recognizable", () => {
    expect(deterministicMessageId("draft-1")).toBe(deterministicMessageId("draft-1"));
    expect(deterministicMessageId("draft-1")).toContain("draft-1");
    expect(deterministicMessageId("draft-1")).not.toBe(deterministicMessageId("draft-2"));
  });
});

describe("buildMimeMessage", () => {
  it("builds a plain text message with the headers Gmail threading needs", () => {
    const raw = buildMimeMessage({
      from: "tai@trust-tai.com",
      to: ["dana@x.com"],
      subject: "Following up",
      bodyText: "Hi Dana",
      messageId: "<comms-d1@trusttai.com>",
      inReplyTo: "<m1@x.com>",
      references: ["<m1@x.com>"],
    });
    expect(raw).toContain("From: tai@trust-tai.com");
    expect(raw).toContain("To: dana@x.com");
    expect(raw).toContain("Subject: Following up");
    expect(raw).toContain("Message-ID: <comms-d1@trusttai.com>");
    expect(raw).toContain("In-Reply-To: <m1@x.com>");
    expect(raw).toContain("References: <m1@x.com>");
    expect(raw).toContain("\r\n");
    expect(raw).not.toContain("multipart/mixed");
    const body = raw.split("\r\n\r\n")[1] ?? "";
    expect(atob(body.replace(/\r\n/g, ""))).toBe("Hi Dana");
  });

  it("encodes a non-ASCII subject as an RFC 2047 word", () => {
    const raw = buildMimeMessage({
      from: "tai@trust-tai.com",
      to: ["dana@x.com"],
      subject: "Héllo, Grüße",
      bodyText: "Hi",
    });
    expect(raw).toContain("Subject: =?UTF-8?B?");
    expect(raw).not.toContain("Héllo");
  });

  it("carries attachments as multipart/mixed with the text part first", () => {
    const raw = buildMimeMessage({
      from: "tai@trust-tai.com",
      to: ["dana@x.com"],
      cc: ["lee@y.com"],
      subject: "Docs",
      bodyText: "Attached.",
      messageId: "<comms-d2@trusttai.com>",
      attachments: [
        { filename: "brief.pdf", mimeType: "application/pdf", size: 3, contentBase64: "QUJD" },
      ],
    });
    expect(raw).toContain("Cc: lee@y.com");
    expect(raw).toContain("multipart/mixed");
    expect(raw).toContain('filename="brief.pdf"');
    expect(raw).toContain("Content-Type: application/pdf");
    const boundary = raw.match(/boundary="([^"]+)"/)?.[1] ?? "";
    expect(boundary).toContain("commsd2");
    const textFirst = raw.indexOf("text/plain");
    const filePart = raw.indexOf("application/pdf");
    expect(textFirst).toBeGreaterThan(-1);
    expect(filePart).toBeGreaterThan(textFirst);
    expect(raw.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("appends nothing the person did not write", () => {
    const raw = buildMimeMessage({
      from: "tai@trust-tai.com",
      to: ["dana@x.com"],
      subject: "Hi",
      bodyText: "Exactly these words.",
    });
    const body = raw.split("\r\n\r\n")[1] ?? "";
    expect(atob(body.replace(/\r\n/g, ""))).toBe("Exactly these words.");
  });
});

describe("encodeRawEmail", () => {
  it("is base64url: no plus, slash, or padding, and round-trips", () => {
    const raw = buildMimeMessage({
      from: "tai@trust-tai.com",
      to: ["dana@x.com"],
      subject: "Grüße aus Nashville",
      bodyText: "Line one\nLine two — with unicode ✓",
    });
    const encoded = encodeRawEmail(raw);
    expect(encoded).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(
      encoded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe(raw);
  });
});

describe("gmailComposeUrl", () => {
  it("opens compose with the recipient and subject filled", () => {
    const url = gmailComposeUrl({ to: ["dana@x.com"], subject: "Hi there", body: "Words" });
    expect(url).toContain("mail.google.com");
    expect(url).toContain("view=cm");
    expect(url).toContain("su=Hi+there");
  });
});

describe("formatBytes", () => {
  it("reads like a person reads sizes", () => {
    expect(formatBytes(840)).toBe("840 B");
    expect(formatBytes(12_400)).toBe("12 KB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });
});
