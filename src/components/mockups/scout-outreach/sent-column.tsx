import { cn } from "@/lib/utils";
import type { SentEmail } from "./types";

interface SentColumnProps {
  sent: SentEmail[];
}

function statusClass(status: SentEmail["statuses"][number]) {
  if (status === "replied") return "border-success/25 bg-success/8 text-success";
  if (status === "opened") return "border-royal/25 bg-royal/8 text-royal";
  return "border-border bg-secondary text-muted-foreground";
}

function statusLabel(status: SentEmail["statuses"][number]) {
  if (status === "replied") return "Replied";
  if (status === "opened") return "Opened";
  return "Sent";
}

export function SentColumn({ sent }: SentColumnProps) {
  return (
    <section className="tt-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="tt-title-card text-base">Sent</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {sent.length}
        </span>
      </div>

      <div className="space-y-3">
        {sent.map((item) => (
          <article
            key={item.id}
            className={cn(
              "rounded-xl border p-4",
              item.highlight ? "border-royal/30 bg-royal-wash" : "border-border bg-card",
            )}
          >
            <div>
              <h3 className="text-sm font-medium text-foreground">
                {item.recipient} · {item.company}
              </h3>
              <p className="text-xs text-muted-foreground">
                {item.email} · {item.sentDate}
              </p>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {item.statuses.map((status) => (
                <span
                  key={status}
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
                    statusClass(status),
                  )}
                >
                  {statusLabel(status)}
                </span>
              ))}
            </div>

            {item.highlight ? (
              <p className="mt-3 text-[13px] font-medium text-royal">{item.highlight}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
