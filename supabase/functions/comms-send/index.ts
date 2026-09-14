/**
 * comms-send — RETIRED PATH (deployed as v6, verify_jwt = true).
 *
 * The previous body (v5) ran with the service role, took a draft's own
 * `review_state = 'approved'` as proof of approval — a value any member could
 * write from a browser — and never checked that the caller belonged to the
 * workspace whose draft it sent. It was replaced on the shared project by
 * this body as v6 with `verify_jwt = true`.
 *
 * This body sends nothing, writes nothing, and refuses every request with an
 * explanation and the route to use instead. It lives here, at the standard
 * path, so an ordinary redeploy of this project cannot restore the unsafe
 * version by accident. The previous body remains in git history, and the
 * function's own version history on the project allows a rollback.
 *
 * DEPLOYMENT AND TEST RECORD: docs/comms-send-legacy-retirement.md
 *
 * Do not redeploy from here without reading that file.
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
