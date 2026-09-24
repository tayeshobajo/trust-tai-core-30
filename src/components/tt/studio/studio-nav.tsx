import { Link } from "@tanstack/react-router";

/** Studio's own section switch. Audience lives inside Studio, not as a new room. */
export function StudioNav({ current }: { current: "content" | "audience" }) {
  const item = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
      active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
    }`;
  return (
    <nav aria-label="Studio sections" className="flex gap-1 rounded-full border border-border bg-card p-1 w-fit">
      <Link to="/modules/studio" className={item(current === "content")} aria-current={current === "content" ? "page" : undefined}>
        Content
      </Link>
      <Link to="/modules/studio/audience" className={item(current === "audience")} aria-current={current === "audience" ? "page" : undefined}>
        Audience
      </Link>
    </nav>
  );
}
