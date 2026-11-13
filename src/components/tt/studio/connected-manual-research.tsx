import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { studioManualAction } from "@/data/studio-manual.functions";
import { createStudioManualAdapter } from "@/domain/studio-manual-wire";
import { ManualResearch } from "./manual-research";
export function ConnectedManualResearch({ organizationId }: { organizationId: string }) {
  return <Connection key={organizationId} organizationId={organizationId} />;
}
function Connection({ organizationId }: { organizationId: string }) {
  const send = useServerFn(studioManualAction),
    [available, setAvailable] = useState(false),
    [launchAllowed, setLaunchAllowed] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const adapter = useMemo(
    () => createStudioManualAdapter(organizationId, (input) => send({ data: input })),
    [organizationId, send],
  );
  return (
    <>
      <div className="sr-note">
        <button
          className="sv-button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void send({ data: { operation: "check", organizationId } })
              .then((reply) => {
                setAvailable(reply.status === "available");
                setLaunchAllowed(reply.status === "available" && reply.launchAllowed === true);
                setMessage(
                  reply.status === "available"
                    ? reply.launchAllowed === true
                      ? "Manual research connection is configured."
                      : "Connected for settlement only. Recover the existing trial to check, stop, reconcile or review it."
                    : "Manual research is not connected yet. You can still explore the local example.",
                );
              })
              .catch(() => {
                setAvailable(false);
                setMessage("Connection could not be verified. Try checking again.");
              })
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Checking…" : "Check manual research connection"}
        </button>
        <p role="status">{message}</p>
      </div>
      <ManualResearch organizationId={organizationId} {...(available ? { adapter, settlementOnly: !launchAllowed } : {})} />
    </>
  );
}
