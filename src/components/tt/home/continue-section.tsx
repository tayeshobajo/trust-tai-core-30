import { ArrowUpRight } from "lucide-react";

import { AppLink } from "@/components/tt/app-link";
import { APP_REGISTRY } from "@/domain/registry";

export interface ContinueItem {
  id: string;
  /** Room this item belongs to, by registry app id. */
  appId: string;
  title: string;
  meta?: string | undefined;
}

/** Two to four real things you were last near. Quiet by design. */
export function ContinueSection({ items }: { items: ContinueItem[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="continue-heading" className="h-full">
      <h2 id="continue-heading" className="font-display text-2xl text-foreground">
        Continue where you left off
      </h2>

      <ul className="mt-5 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {items.map((item) => {
          const app = APP_REGISTRY.find((a) => a.id === item.appId);
          const body = (
            <span className="flex items-center gap-4 px-5 py-4">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{item.title}</span>
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {app?.name ?? item.appId}
                  {item.meta ? ` · ${item.meta}` : ""}
                </span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </span>
          );

          return (
            <li key={item.id}>
              {app ? (
                <AppLink app={app} className="block transition-colors hover:bg-cloud">
                  {body}
                </AppLink>
              ) : (
                <span className="block">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
