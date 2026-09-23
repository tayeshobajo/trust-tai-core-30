import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

/**
 * Starts the AI teammate as the person whose request is in flight (their own
 * bearer token, RLS applies). No request token means no start: the task stays
 * queued and the AI page offers Run. Never impersonates anyone.
 */
export async function dispatchAgentFromRequest(input: {
  organizationId: string;
  taskId: string;
  writer: SupabaseClient;
}): Promise<{ started: boolean; note: string }> {
  let token = "";
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const auth = getRequest()?.headers.get("authorization") ?? "";
    token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  } catch {
    token = "";
  }
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!token || !url || !key) return { started: false, note: "AI work did not start." };
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (req, init) => {
        const h = new Headers(init?.headers);
        h.set("apikey", key);
        h.set("Authorization", `Bearer ${token}`);
        return fetch(req, { ...init, headers: h });
      },
    },
  });
  const user = await client.auth.getUser(token);
  const userId = user.data.user?.id;
  if (!userId) return { started: false, note: "AI work did not start." };
  const { executeStewardAgentTask } = await import("@/lib/steward-agent-runner.server");
  try {
    const r = await executeStewardAgentTask({
      client,
      writer: input.writer,
      organizationId: input.organizationId,
      taskId: input.taskId,
      agentId: "trust-tai-internal",
      userId,
      token,
    });
    return { started: true, note: r.note };
  } catch {
    return { started: false, note: "AI work did not start." };
  }
}
