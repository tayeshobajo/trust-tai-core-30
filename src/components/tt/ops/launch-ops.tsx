/**
 * The one way into Ops.
 *
 * Reads the current session at the moment of the click, opens the Ops SSO
 * waiting screen, and hands the token over only after Ops answers from its own
 * origin. No session, no launch. No fallback that would put a token in a URL.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import { supabase } from "@/integrations/trust-tai/supabase";
import { OPS_LAUNCH_MESSAGE, launchOps, type OpsLaunchFailure } from "@/lib/ops-launch";

export function LaunchOpsButton({
  canonicalProjectId,
  label = "Open Ops",
  variant = "primary",
}: {
  canonicalProjectId?: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [state, setState] = useState<"idle" | "opening" | "open">("idle");
  const [failure, setFailure] = useState<OpsLaunchFailure | null>(null);

  async function open() {
    setState("opening");
    setFailure(null);
    const { data } = await supabase.auth.getSession();
    const result = await launchOps({
      accessToken: data.session?.access_token ?? null,
      ...(canonicalProjectId ? { canonicalProjectId } : {}),
    });
    if (result.ok) {
      setState("open");
      return;
    }
    setState("idle");
    setFailure(result.reason);
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <TTButton variant={variant} disabled={state === "opening"} onClick={() => void open()}>
        {state === "opening" ? "Opening Ops…" : failure ? "Try Ops again" : label}
      </TTButton>
      {state === "open" ? (
        <p className="text-sm text-muted-foreground">Ops opened in a new tab.</p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {OPS_LAUNCH_MESSAGE[failure]}
        </p>
      ) : null}
    </div>
  );
}
