import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { trustTaiSupabaseUrl, trustTaiSupabaseKey } from "@/lib/trust-tai-backend.server";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
export async function readRfpSource(request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token)
    return Response.json({ error: "Sign in to read a source." }, { status: 401, headers });
  const client = createClient(trustTaiSupabaseUrl(), trustTaiSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const user = await client.auth.getUser();
  if (user.error || !user.data.user)
    return Response.json({ error: "Sign in to read a source." }, { status: 401, headers });
  // Limit the request before parsing; URL only, never uploaded document bytes.
  const reader = request.body?.getReader();
  let raw = "";
  if (reader) {
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        return Response.json({ error: "Request too large." }, { status: 413, headers });
      }
      raw += new TextDecoder().decode(value);
    }
  }
  let body: { organization_id?: string; url?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400, headers });
  }
  if (
    typeof body.organization_id !== "string" ||
    typeof body.url !== "string" ||
    body.url.length > 2048
  )
    return Response.json({ error: "Enter a source URL." }, { status: 400, headers });
  const access = await client.rpc("rfp_has_access", {
    org: body.organization_id,
    scope: body.organization_id,
    writing: true,
  });
  if (access.error || access.data !== true)
    return Response.json({ error: "RFP work access is required." }, { status: 403, headers });
  // Deliberately fail closed. The Node reader prototype cannot safely pin
  // hostname-verified connections on the supported Cloudflare runtime.
  return Response.json(
    {
      error:
        "Automatic URL reading is not connected. Upload a PDF/DOCX or paste source text for review.",
    },
    { status: 501, headers },
  );
}
export const Route = createFileRoute("/api/public/rfps/source")({
  server: { handlers: { POST: ({ request }) => readRfpSource(request) } },
});
