/**
 * Email body fidelity, proven without a network.
 *
 * These tests are the milestone's acceptance list made executable: decoding,
 * MIME walking, sanitization, inline-vs-file separation, quoted splitting,
 * and the collapse rule.
 */

import { describe, expect, it } from "vitest";

import {
  decodeBase64UrlToText,
  emailNeedsCollapse,
  extractEmailBody,
  htmlToPlainText,
  parseEmailHtml,
  sanitizeEmailHtml,
  splitQuotedContent,
  splitQuotedNodes,
  type MimePart,
} from "./comms-email-body";

/** base64url, as Gmail writes it: no padding, `-` and `_`. */
function b64url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("decodeBase64UrlToText", () => {
  it("decodes unpadded base64url with url-safe characters", () => {
    // Chosen so the base64 alphabet's +/ become -/_
    const original = "Line one\nLine two — unicode ✓ and bytes";
    expect(decodeBase64UrlToText(b64url(original))).toBe(original);
  });

  it("returns empty for empty", () => {
    expect(decodeBase64UrlToText("")).toBe("");
  });
});

describe("extractEmailBody — plain text", () => {
  it("reads a simple single-part plain-text body", () => {
    const payload: MimePart = {
      mimeType: "text/plain",
      body: { data: b64url("Hello Riley,\n\nThe proposal is attached.\n\nTai"), size: 42 },
    };
    const result = extractEmailBody(payload);
    expect(result.bodyText).toBe("Hello Riley,\n\nThe proposal is attached.\n\nTai");
    expect(result.bodyHtml).toBeUndefined();
    expect(result.attachments).toEqual([]);
    expect(result.inline).toEqual([]);
  });

  it("keeps the whole body, far beyond Gmail's snippet length", () => {
    const long = "word ".repeat(600).trim(); // ~3000 chars; snippets are ~180
    const payload: MimePart = {
      mimeType: "text/plain",
      body: { data: b64url(long), size: long.length },
    };
    const result = extractEmailBody(payload);
    expect(result.bodyText).toBe(long);
    expect(result.bodyText!.length).toBeGreaterThan(1000);
  });
});

describe("extractEmailBody — multipart/alternative", () => {
  it("prefers plain text for bodyText and keeps sanitized HTML alongside", () => {
    const payload: MimePart = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Plain words here."), size: 17 } },
        {
          mimeType: "text/html",
          body: { data: b64url("<p><b>Rich</b> words here.</p>"), size: 30 },
        },
      ],
    };
    const result = extractEmailBody(payload);
    expect(result.bodyText).toBe("Plain words here.");
    expect(result.bodyHtml).toContain("<b>Rich</b>");
  });

  it("flattens HTML to text when no plain part exists", () => {
    const payload: MimePart = {
      mimeType: "text/html",
      body: { data: b64url("<p>First line.</p><p>Second line.</p>"), size: 40 },
    };
    const result = extractEmailBody(payload);
    expect(result.bodyText).toBe("First line.\nSecond line.");
    expect(result.bodyHtml).toContain("First line.");
  });

  it("does not treat multipart containers as attachments", () => {
    const payload: MimePart = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64url("Body."), size: 5 } },
          ],
        },
      ],
    };
    const result = extractEmailBody(payload);
    expect(result.attachments).toEqual([]);
    expect(result.bodyText).toBe("Body.");
  });
});

describe("extractEmailBody — multipart/related inline images", () => {
  const payload: MimePart = {
    mimeType: "multipart/related",
    parts: [
      {
        mimeType: "text/html",
        body: {
          data: b64url('<p>See below.</p><img src="cid:logo@acme" alt="Logo" />'),
          size: 50,
        },
      },
      {
        mimeType: "image/png",
        filename: "logo.png",
        headers: [
          { name: "Content-ID", value: "<logo@acme>" },
          { name: "Content-Disposition", value: "inline; filename=logo.png" },
        ],
        body: { attachmentId: "att-inline-1", size: 12000 },
      },
      {
        mimeType: "application/pdf",
        filename: "brief.pdf",
        headers: [{ name: "Content-Disposition", value: "attachment; filename=brief.pdf" }],
        body: { attachmentId: "att-file-1", size: 80000 },
      },
    ],
  };

  it("separates the inline image from the ordinary file", () => {
    const result = extractEmailBody(payload);
    expect(result.inline).toHaveLength(1);
    expect(result.inline[0]).toMatchObject({
      filename: "logo.png",
      mimeType: "image/png",
      attachmentId: "att-inline-1",
      contentId: "logo@acme",
      inline: true,
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      filename: "brief.pdf",
      attachmentId: "att-file-1",
    });
    expect(result.attachments[0]!.inline).toBeUndefined();
  });

  it("keeps the cid reference in the sanitized HTML so it can resolve", () => {
    const result = extractEmailBody(payload);
    expect(result.bodyHtml).toContain('data-cid="logo@acme"');
  });

  it("treats an attachment-disposition image as an ordinary file", () => {
    const result = extractEmailBody({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Hi"), size: 2 } },
        {
          mimeType: "image/png",
          filename: "photo.png",
          headers: [{ name: "Content-Disposition", value: "attachment; filename=photo.png" }],
          body: { attachmentId: "att-2", size: 9000 },
        },
      ],
    });
    expect(result.inline).toEqual([]);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]!.filename).toBe("photo.png");
  });

  it("names an unnamed inline image from its Content-ID", () => {
    const result = extractEmailBody({
      mimeType: "multipart/related",
      parts: [
        { mimeType: "text/html", body: { data: b64url('<img src="cid:x1" />'), size: 20 } },
        {
          mimeType: "image/jpeg",
          headers: [{ name: "Content-ID", value: "<x1>" }],
          body: { attachmentId: "att-3", size: 5000 },
        },
      ],
    });
    expect(result.inline[0]!.filename).toBe("x1.jpg");
  });
});

describe("sanitizeEmailHtml — the security boundary", () => {
  it("strips scripts, iframes, forms, and event handlers", () => {
    const dirty =
      '<p onclick="steal()">Hi</p>' +
      '<script>alert(1)</script>' +
      '<iframe src="https://evil.example"></iframe>' +
      '<form action="https://evil.example"><input name="pw" /></form>' +
      '<a href="#" onmouseover="track()">link</a>';
    const { html } = sanitizeEmailHtml(dirty);
    expect(html).toContain("Hi");
    expect(html).not.toContain("script");
    expect(html).not.toContain("iframe");
    expect(html).not.toContain("form");
    expect(html).not.toContain("input");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("onmouseover");
    expect(html).toContain("link"); // the anchor survives, its handler does not
  });

  it("refuses javascript: and data: URLs but keeps https and mailto", () => {
    const dirty =
      '<a href="javascript:alert(1)">bad</a>' +
      '<a href="data:text/html,<script>alert(1)</script>">worse</a>' +
      '<a href="https://example.com/doc">good</a>' +
      '<a href="mailto:tai@trusttai.com">mail</a>';
    const { html } = sanitizeEmailHtml(dirty);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).toContain('href="https://example.com/doc"');
    expect(html).toContain('href="mailto:tai@trusttai.com"');
  });

  it("never auto-loads remote images, and counts the refusal", () => {
    const dirty =
      '<img src="https://tracker.example/pixel.gif" width="1" height="1" />' +
      '<img src="https://cdn.example/banner.png" alt="Banner" />' +
      '<img src="cid:real@inline" alt="Kept" />';
    const { html, blockedRemoteImages } = sanitizeEmailHtml(dirty);
    expect(blockedRemoteImages).toBe(2);
    expect(html).not.toContain("tracker.example");
    expect(html).not.toContain("cdn.example");
    expect(html).toContain('data-cid="real@inline"');
    expect(html).toContain('alt="Kept"');
  });

  it("drops style tags with contents and keeps the text of unknown tags", () => {
    const dirty = "<style>body{display:none}</style><font color=red>Visible</font>";
    const { html } = sanitizeEmailHtml(dirty);
    expect(html).not.toContain("display:none");
    expect(html).toContain("Visible");
    expect(html).not.toContain("<font");
  });

  it("escapes stray markup characters in text", () => {
    const { html } = sanitizeEmailHtml("<p>1 < 2 & 3 > 2</p>");
    expect(html).toContain("1 &lt; 2 &amp; 3 &gt; 2");
  });

  it("balances tags the sender left open", () => {
    const { html } = sanitizeEmailHtml("<div><p>Never closed");
    expect(html).toBe("<div><p>Never closed</p></div>");
  });
});

describe("parseEmailHtml", () => {
  it("builds a node tree with links, images, and quoted blocks", () => {
    const { html } = sanitizeEmailHtml(
      '<p>Hello <b>there</b></p><a href="https://x.example">Doc</a>' +
        '<img src="cid:img1" alt="Chart" />' +
        '<div class="gmail_quote"><blockquote>Earlier words</blockquote></div>',
    );
    const nodes = parseEmailHtml(html);
    expect(nodes.map((node) => (node.type === "element" ? node.tag : "text"))).toEqual([
      "p",
      "a",
      "img",
      "div",
    ]);
    const link = nodes[1]!;
    expect(link.type === "element" && link.href).toBe("https://x.example");
    const image = nodes[2]!;
    expect(image.type === "element" && image.cid).toBe("img1");
  });
});

describe("splitQuotedNodes", () => {
  it("splits at the first top-level quoted block", () => {
    const nodes = parseEmailHtml(
      sanitizeEmailHtml(
        "<p>My reply.</p><blockquote><p>What you wrote.</p></blockquote>",
      ).html,
    );
    const { main, quoted } = splitQuotedNodes(nodes);
    expect(main).toHaveLength(1);
    expect(quoted).toHaveLength(1);
  });

  it("keeps a quote-only message whole — fidelity over stripping", () => {
    const nodes = parseEmailHtml(sanitizeEmailHtml("<blockquote>All of it.</blockquote>").html);
    const { main, quoted } = splitQuotedNodes(nodes);
    expect(quoted).toEqual([]);
    expect(main).toHaveLength(1);
  });
});

describe("splitQuotedContent", () => {
  it("splits a Gmail-style reply from its quoted history", () => {
    const body =
      "Sounds good — see you Thursday.\n\nOn Tue, Aug 18, 2026 at 2:14 PM Riley <riley@x.com> wrote:\n> Are we still on for Thursday?";
    const split = splitQuotedContent(body);
    expect(split.main).toBe("Sounds good — see you Thursday.");
    expect(split.quoted).toContain("Are we still on for Thursday?");
  });

  it("splits on Outlook's Original Message marker", () => {
    const body = "Confirmed.\n\n-----Original Message-----\nFrom: Riley\nSent: Tuesday";
    const split = splitQuotedContent(body);
    expect(split.main).toBe("Confirmed.");
    expect(split.quoted).toContain("From: Riley");
  });

  it("splits on '>' quoted lines", () => {
    const body = "Agreed on both counts.\n> First point\n> Second point";
    const split = splitQuotedContent(body);
    expect(split.main).toBe("Agreed on both counts.");
    expect(split.quoted).toBe("> First point\n> Second point");
  });

  it("leaves a message with no quoting untouched", () => {
    const body = "Just a plain note.\n\nWith a signature.\nTai";
    expect(splitQuotedContent(body).quoted).toBeUndefined();
  });

  it("keeps a quote-only message whole", () => {
    const body = "On Tue, someone wrote:\n> everything is quoted";
    expect(splitQuotedContent(body).quoted).toBeUndefined();
  });
});

describe("htmlToPlainText", () => {
  it("turns block boundaries into line breaks and decodes entities", () => {
    expect(htmlToPlainText("<p>One &amp; two</p><p>Three</p>")).toBe("One & two\nThree");
  });
});

describe("emailNeedsCollapse", () => {
  it("flags long bodies so the UI folds instead of clamping", () => {
    expect(emailNeedsCollapse("word ".repeat(400), undefined)).toBe(true);
    expect(emailNeedsCollapse(undefined, `<p>${"word ".repeat(400)}</p>`)).toBe(true);
  });

  it("leaves short bodies unfolded", () => {
    expect(emailNeedsCollapse("A short note.", undefined)).toBe(false);
    expect(emailNeedsCollapse(undefined, undefined)).toBe(false);
  });

  it("never collapses an email because of inline images", () => {
    const img = `<img src="cid:hero@att" alt="" width="1200" height="900">`;
    // An image that is the whole message.
    expect(emailNeedsCollapse(undefined, `<div>${img}</div>`)).toBe(false);
    // A short note carrying a large inline image shows whole by default.
    expect(
      emailNeedsCollapse(undefined, `<p>Here is the mockup we discussed.</p><div>${img}</div>`),
    ).toBe(false);
    expect(emailNeedsCollapse("Here is the mockup we discussed.", `<p>note</p>${img}`)).toBe(false);
  });

  it("ignores blank structural lines from layout markup", () => {
    const scaffolding = "<div><br></div>".repeat(30);
    expect(emailNeedsCollapse(undefined, `${scaffolding}<p>Short note.</p>${scaffolding}`)).toBe(
      false,
    );
  });

  it("still folds genuinely long prose", () => {
    const prose = Array.from({ length: 25 }, (_, i) => `Line ${i} with a few real words.`).join(
      "\n",
    );
    expect(emailNeedsCollapse(prose, undefined)).toBe(true);
  });
});

describe("extractEmailBody — remote image privacy", () => {
  it("blocks remote images during extraction and counts them on the message", () => {
    const result = extractEmailBody({
      mimeType: "text/html",
      body: {
        data: b64url('<p>Hi</p><img src="https://tracker.example/open.gif" />'),
        size: 60,
      },
    });
    expect(result.blockedRemoteImages).toBe(1);
    expect(result.bodyHtml).not.toContain("tracker.example");
  });
});
