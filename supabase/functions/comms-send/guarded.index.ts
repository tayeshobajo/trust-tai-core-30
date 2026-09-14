/**
 * comms-send — FAIL-CLOSED REPLACEMENT (prepared, NOT deployed).
 *
 * The deployed `comms-send` function (v5 on the shared Supabase project) runs
 * with the service role, takes a draft's own `review_state = 'approved'` as
 * proof of approval — a value any member can write from a browser — and never
 * checks that the caller belongs to the workspace whose draft it sends.
 * Nothing in this app calls it any more, but it is still live and still
 * reachable by anyone holding a session token, so replacing the UI call sites
 * did not retire it.
 *
 * This file is the replacement body. It sends nothing, writes nothing, and
 * refuses every request with an explanation and the route to use instead. It
 * is deliberately reversible: deploying it changes only the function body, so
 * the previous version can be restored from the function's version history if
 * anything unexpected depended on it.
 *
 * DEPLOYMENT AND TEST INSTRUCTIONS: docs/comms-send-legacy-retirement.md
 *
 * Deployment is Codex's to perform. This file is not wired into anything and
 * is not imported by the app.
 */

const REPLACEMENT = "/api/public/comms/send";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

Deno.serve((request: Request): Response => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  /* Nothing is read, nothing is written, nothing is sent. A refusal here is
     the whole purpose: this path could send a message that no review ever
     approved. */
  console.warn("[comms-send] refused: retired path", {
    method: request.method,
    caller: request.headers.get("user-agent") ?? "unknown",
  });

  return json(
    {
      error:
        "This send path has been retired. Nothing was sent and nothing was changed. Messages now go out through Trust Tai OS, which requires a completed review approved for exactly the message being sent.",
      replacement: REPLACEMENT,
      retired: true,
    },
    410,
  );
});
