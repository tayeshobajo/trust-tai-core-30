#!/usr/bin/env npx tsx
/**
 * Wake regression test, guards the /wakeup body contract.
 *
 * Paperclip 2026.722.0 requires POST /api/agents/:id/wakeup to carry a JSON
 * object body. Sending no body returns 400 (validation error), which the old
 * requestFirstMatch surfaced as a thrown error from the client. This test
 * asserts the client returns a queued/running heartbeat run instead.
 *
 * Run: npx tsx scripts/qa/wake-regression.ts
 */
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) {
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  }
}

const COMMS_AGENT = "239a7269-6309-4547-bd54-67e4e3798b85";

const { paperclipClient } = await import("../../src/lib/paperclip-client.server");
const wake = (await paperclipClient.triggerHeartbeat(COMMS_AGENT)) as {
  id?: string;
  status?: string;
  invocationSource?: string;
};

if (!wake.id || !wake.status) {
  console.error(
    `FAIL: triggerHeartbeat did not return a heartbeat run, got ${JSON.stringify(wake).slice(0, 200)}`,
  );
  process.exit(1);
}
console.log(
  `PASS: wake → run ${wake.id.slice(0, 8)} status=${wake.status} source=${wake.invocationSource}`,
);
