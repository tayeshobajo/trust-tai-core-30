import { createClient } from "@supabase/supabase-js";
import type { ExecutionDatabase } from "@/lib/execution-bridge.types";
const c = createClient<ExecutionDatabase>("u","k");
const q = c.from("prospects").select("*");
type R = Awaited<typeof q>["data"];
export const x: R = null;
