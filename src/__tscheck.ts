import { trustTaiServiceRoleClient } from "@/lib/execution-bridge.server";
const c = trustTaiServiceRoleClient();
export async function t() {
  const { data } = await c.from("prospects").select("id, organization_id").maybeSingle();
  const bad: string = data!.id;
  const ins = await c.from("execution_bindings").insert({ organization_id: "x" }).select("*").maybeSingle();
  return [bad, ins];
}
