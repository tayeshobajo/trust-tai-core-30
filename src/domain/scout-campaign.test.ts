import { describe, expect, it } from "vitest";

import {
  campaignKey,
  dedupeRecipients,
  queueStateFor,
  recipientEligibility,
  renderTemplate,
  type CampaignRecipientInput,
} from "./scout-campaign";

const robin: CampaignRecipientInput = {
  personId: "p1",
  fullName: "Robin Shah",
  title: "Co-founder",
  company: "Synthetic Co",
  workEmail: "robin@example.test",
  emailState: "verified",
};

describe("scout campaign", () => {
  it("C1 only verified or explicitly accepted work emails are eligible", () => {
    expect(recipientEligibility(robin).ok).toBe(true);
    expect(recipientEligibility({ ...robin, emailState: "found_unverified" }).ok).toBe(false);
    expect(recipientEligibility({ ...robin, emailState: "found_unverified", acceptedUnverified: true }).ok).toBe(true);
    expect(recipientEligibility({ ...robin, workEmail: null }).ok).toBe(false);
    expect(recipientEligibility({ ...robin, personId: null }).ok).toBe(false);
    expect(recipientEligibility({ ...robin, emailState: "stale" }).ok).toBe(false);
  });

  it("C1 fills placeholders", () => {
    const r = renderTemplate({ subject: "Hi {first_name}", body: "As {title} at {company}…" }, robin);
    expect(r).toEqual({ ok: true, subject: "Hi Robin", body: "As Co-founder at Synthetic Co…" });
  });

  it("C4 unfillable or unknown placeholders block rather than send blanks", () => {
    const r = renderTemplate({ subject: "Hi {first_name}", body: "As {title}, {nickname}" }, { ...robin, title: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["title", "nickname"]);
  });

  it("C5 dedupes by saved person and by address", () => {
    const list = dedupeRecipients([robin, { ...robin }, { ...robin, personId: "p2", workEmail: "ROBIN@example.test" }, { ...robin, personId: "p3", workEmail: "k@example.test" }]);
    expect(list.map((r) => r.personId)).toEqual(["p1", "p3"]);
  });

  it("C3 maps review states to the send queue; nothing is sent by preparing", () => {
    expect(queueStateFor(undefined)).toBe("drafting");
    expect(queueStateFor("draft")).toBe("needs_review");
    expect(queueStateFor("approved")).toBe("approved");
    expect(queueStateFor("sent")).toBe("sent");
    expect(campaignKey("x", " Q4 Intro ")).toBe("scout:prospect:x:campaign:q4-intro");
  });
});
