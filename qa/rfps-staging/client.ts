import { createClient } from "@supabase/supabase-js";
import { stagingConfig, stagingFetch } from "./guard";
const config = stagingConfig(import.meta.env);
export const supabase = createClient(config.url, config.key, {
  global: { fetch: stagingFetch(config) },
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    storageKey: `rfp-staging-${config.projectRef}`,
  },
});
export const supabaseConfig = {
  url: config.url,
  projectRef: config.projectRef,
  configuredFromEnv: true,
};
