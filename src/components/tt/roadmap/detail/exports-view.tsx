/**
 * Roadmap detail — Exports.
 *
 * A client copy is frozen at the moment it is created. Nothing here rewrites an
 * earlier version: a change to the roadmap produces a new one, so what a client
 * was sent stays readable exactly as it was sent.
 */

import { TTButton } from "@/components/tt/primitives";
import { DetailSection } from "./parts";
import type { RoadmapExport } from "@/domain/roadmap-exports";
import { EXPORT_STATUS_LABEL } from "@/domain/roadmap-exports";

export function ExportsView({
  exports,
  available,
  canExport,
  blockedBecause,
  creating,
  sendingId,
  onCreate,
  onMarkSent,
}: {
  exports: RoadmapExport[];
  available: boolean;
  canExport: boolean;
  blockedBecause: string;
  creating: boolean;
  sendingId: string | null;
  onCreate: () => void;
  onMarkSent: (exportId: string) => void;
}) {
  if (!available) {
    return (
      <DetailSection
        eyebrow="Exports"
        title="Client copies are not set up in this backend yet"
        supporting="Apply docs/roadmap-exports-schema.sql to the shared backend to start freezing client copies."
      >
        <p className="text-[13px] text-muted-foreground">
          Until then the roadmap still works in full; only the frozen client copy is unavailable.
        </p>
      </DetailSection>
    );
  }

  return (
    <DetailSection
      eyebrow="Exports"
      title="Client copies"
      supporting="Each copy is a frozen snapshot of approved milestones and the destination as it stood."
      action={
        <TTButton size="sm" disabled={!canExport || creating} onClick={onCreate}>
          {creating ? "Freezing copy…" : "Create client copy"}
        </TTButton>
      }
    >
      {!canExport ? (
        <p className="mb-4 text-[13px] text-muted-foreground">{blockedBecause}</p>
      ) : null}

      {exports.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No client copy exists yet. The first one records exactly what the client was shown.
        </p>
      ) : (
        <ul className="space-y-3">
          {exports.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-4"
            >
              <div className="min-w-0">
                <p className="text-[14px] text-foreground">Version {entry.version}</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {EXPORT_STATUS_LABEL[entry.status]} ·{" "}
                  {new Date(entry.createdAt).toLocaleDateString()} ·{" "}
                  {entry.snapshot.milestones?.length ?? 0} milestones
                </p>
                {entry.snapshot.pointBProposed ? (
                  <p className="mt-1 text-[12px] text-warning">
                    Point B travelled as a proposal in this copy.
                  </p>
                ) : null}
              </div>
              {entry.status !== "sent" ? (
                <TTButton
                  variant="secondary"
                  size="sm"
                  disabled={sendingId === entry.id}
                  onClick={() => onMarkSent(entry.id)}
                >
                  {sendingId === entry.id ? "Recording…" : "Mark as sent"}
                </TTButton>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  Sent {entry.sentAt ? new Date(entry.sentAt).toLocaleDateString() : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
