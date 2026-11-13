import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  callbackDestinationMatches as matches,
  CALLBACK_EXTERNAL_BASE as external,
  CALLBACK_RUNTIME_BASE as runtime,
} from "./studio-research-callback-destination";
import { STUDIO_TRIAL_REQUEST_ID } from "@/domain/studio-research-trial";
const suffix = `/${STUDIO_TRIAL_REQUEST_ID}/authority`;
it("maps only the exact static project/function representations and permitted operations", () => {
  for (const path of [
    "/diagnostic",
    ...["authority", "admission", "result"].map((op) => `/${STUDIO_TRIAL_REQUEST_ID}/${op}`),
  ]) {
    expect(matches(external + path, "POST", external + path)).toBe(true);
    expect(matches(runtime + path, "POST", external + path)).toBe(true);
  }
  for (const path of [
    `/${STUDIO_TRIAL_REQUEST_ID}/run`,
    `/${STUDIO_TRIAL_REQUEST_ID}/read`,
    "/other/authority",
    "/diagnostic/",
  ])
    expect(matches(runtime + path, "POST", external + path)).toBe(false);
  expect(matches(runtime + suffix, "GET", external + suffix)).toBe(false);
  expect(
    readFileSync(
      "qa/studio-callback/inert-v4/supabase/functions/studio-research-coordinator/destination.ts",
      "utf8",
    ),
  ).toBe(readFileSync("src/lib/studio-research-callback-destination.ts", "utf8"));
});
it("rejects all visible unapproved URL components and signed destination variants without normalization", () => {
  for (const base of [external, runtime])
    for (const url of [
      base + suffix + "?x=1",
      base + suffix + "#x",
      base + suffix + "?",
      base + suffix + "#",
      base.replace("://", "://user:pass@") + suffix,
      base.replace(".co", ".co:8080") + suffix,
      base.replace(".co", ".co:" + (base.startsWith("https") ? "443" : "80")) + suffix,
      base.replace("okydosoacqdnursmmenf", "wrong") + suffix,
      base.replace("studio-research-coordinator", "other") + suffix,
      base + "/x/.." + suffix,
      base + "/%2e/" + suffix.slice(1),
      base + suffix.replace("/authority", "/%61uthority"),
      base + suffix.replace("/authority", "%2fauthority"),
      base + suffix + "/",
    ]) {
      expect(matches(url, "POST", external + suffix), url).toBe(false);
      expect(matches(runtime + suffix, "POST", url), url).toBe(false);
    }
  expect(matches(runtime + suffix, "POST", runtime + suffix)).toBe(false);
  expect(matches(runtime + suffix, "POST", external + suffix.replace("authority", "result"))).toBe(
    false,
  );
});
it("documents Request normalization limits rather than claiming unavailable raw-byte inspection", () => {
  for (const raw of [
    runtime.replace(".co", ".co:80") + suffix,
    runtime + "/x/.." + suffix,
    runtime + "/%2e/" + suffix.slice(1),
  ]) {
    expect(matches(raw, "POST", external + suffix)).toBe(false);
    const request = new Request(raw, { method: "POST" });
    expect(request.url).toBe(runtime + suffix);
    expect(matches(request.url, "POST", external + suffix)).toBe(true); // indistinguishable after platform normalization
    expect(matches(request.url, "POST", raw)).toBe(false); // signed literal stays unnormalized and is rejected
  }
  const escaped = new Request(runtime + suffix.replace("authority", "%61uthority"), {
    method: "POST",
  });
  expect(matches(escaped.url, "POST", external + suffix)).toBe(false);
});
