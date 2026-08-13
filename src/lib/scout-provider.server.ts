/**
 * Scout — explicit AI provider selection (server only).
 *
 * Trust Tai owns which intelligence provider answered. Selection is explicit
 * and recorded truthfully on every run and evaluation:
 *
 *   1. `OPENAI_API_KEY` present  → direct OpenAI Responses API (`gpt-5-mini`).
 *   2. otherwise `LOVABLE_API_KEY` → Lovable AI Gateway (`openai/gpt-5-mini`).
 *   3. neither                    → not configured; Scout fails closed and
 *                                   never substitutes preview/demo prospects.
 *
 * A direct OpenAI call is never labelled `lovable`, and vice versa.
 */

export type ScoutProviderName = "openai" | "lovable";

export const OPENAI_DEFAULT_MODEL = "gpt-5-mini";
export const GATEWAY_DEFAULT_MODEL = "openai/gpt-5-mini";

export interface ScoutProvider {
  provider: ScoutProviderName;
  model: string;
  endpoint: string;
  /** Auth + routing headers. Never logged, never returned to the browser. */
  headers: Record<string, string>;
}

type Env = Record<string, string | undefined>;

function configuredModel(env: Env): string | undefined {
  const value = env["SCOUT_DISCOVERY_MODEL"] || env["SCOUT_OPENAI_MODEL"];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** Direct OpenAI takes bare model ids; the gateway requires a vendor prefix. */
export function modelForProvider(provider: ScoutProviderName, env: Env = process.env): string {
  const configured = configuredModel(env);
  if (provider === "openai") {
    if (!configured) return OPENAI_DEFAULT_MODEL;
    return configured.startsWith("openai/") ? configured.slice("openai/".length) : configured;
  }
  if (!configured) return GATEWAY_DEFAULT_MODEL;
  return configured.includes("/") ? configured : `openai/${configured}`;
}

/** The provider Scout will actually use, or null when nothing is configured. */
export function selectScoutProvider(env: Env = process.env): ScoutProvider | null {
  const openaiKey = env["OPENAI_API_KEY"]?.trim();
  if (openaiKey) {
    return {
      provider: "openai",
      model: modelForProvider("openai", env),
      endpoint: "https://api.openai.com/v1/responses",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
    };
  }

  const lovableKey = env["LOVABLE_API_KEY"]?.trim();
  if (lovableKey) {
    return {
      provider: "lovable",
      model: modelForProvider("lovable", env),
      endpoint: "https://ai.gateway.lovable.dev/v1/responses",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": lovableKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
    };
  }

  return null;
}

/** Secret-free status for the config probe. */
export function scoutProviderStatus(env: Env = process.env): {
  configured: boolean;
  provider: ScoutProviderName | null;
  model: string | null;
  capabilities: { webSearch: boolean; structuredOutput: boolean; streaming: boolean };
  fallbackAvailable: boolean;
} {
  const selected = selectScoutProvider(env);
  return {
    configured: Boolean(selected),
    provider: selected?.provider ?? null,
    model: selected?.model ?? null,
    capabilities: {
      webSearch: Boolean(selected),
      structuredOutput: Boolean(selected),
      streaming: Boolean(selected),
    },
    fallbackAvailable: Boolean(env["LOVABLE_API_KEY"]?.trim()),
  };
}
