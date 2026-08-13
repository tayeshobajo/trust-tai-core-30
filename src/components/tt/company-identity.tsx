/**
 * Company identity — shared across Trust Tai apps.
 *
 * `CompanyMark` renders the company's own icon when one of its same-site paths
 * loads, and a refined monogram when none do. `CompanyIdentityHeader` pairs the
 * mark with the company name, domain and whatever status chips the calling app
 * supplies. Comms, Roadmap, Projects, Ops and Pulse can reuse both as-is.
 *
 * A company's real theme colour, when research has recorded one, is used only
 * decoratively: a thin accent rule, a small identity dot and a faint wash.
 * Fit lights, status pills, controls, body text and the OS chrome never change.
 */

import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import {
  companyIconSources,
  companyInitials,
  hostnameOf,
  normalizeThemeColor,
} from "@/lib/company-identity";
import { cn } from "@/lib/utils";

export interface CompanyIdentityProps {
  name: string;
  websiteUrl: string;
  /** Real brand colour from the company's own site. Validated before use. */
  themeColor?: string | null;
  /** Real logo URL recorded by research, when one exists. */
  logoUrl?: string | null;
}

const SIZE = {
  sm: { box: "size-8 rounded-md", text: "text-[11px]" },
  md: { box: "size-12 rounded-lg", text: "text-sm" },
  lg: { box: "size-14 rounded-xl", text: "text-base" },
} as const;

export function CompanyMark({
  name,
  websiteUrl,
  themeColor,
  logoUrl,
  size = "md",
  className,
}: CompanyIdentityProps & { size?: keyof typeof SIZE; className?: string }) {
  const sources = useMemo(
    () => companyIconSources(websiteUrl, logoUrl ?? undefined),
    [websiteUrl, logoUrl],
  );
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [sources]);

  const accent = normalizeThemeColor(themeColor);
  const src = sources[index];
  const style = accent
    ? { borderColor: `color-mix(in oklab, ${accent} 45%, transparent)` }
    : undefined;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden border border-border bg-background",
        SIZE[size].box,
        className,
      )}
      style={style}
    >
      {src ? (
        <img
          src={src}
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-full object-contain p-1.5"
          onError={() => setIndex((i) => i + 1)}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "font-mono uppercase tracking-[0.06em] text-muted-foreground",
            SIZE[size].text,
          )}
        >
          {companyInitials(name)}
        </span>
      )}
    </span>
  );
}

/** Small fit-independent dot that carries the company's own colour, if real. */
export function CompanyAccentDot({ themeColor }: { themeColor?: string | null }) {
  const accent = normalizeThemeColor(themeColor);
  if (!accent) return null;
  return (
    <span
      aria-hidden
      className="inline-block size-1.5 rounded-full"
      style={{ backgroundColor: accent }}
      title="Company colour"
    />
  );
}

/** 2px identity rule drawn from the company's own colour. Decorative only. */
export function CompanyAccentRule({
  themeColor,
  className,
}: {
  themeColor?: string | null;
  className?: string;
}) {
  const accent = normalizeThemeColor(themeColor);
  if (!accent) return null;
  return (
    <span
      aria-hidden
      className={cn("block h-0.5 w-full rounded-full", className)}
      style={{
        background: `linear-gradient(90deg, ${accent} 0%, color-mix(in oklab, ${accent} 20%, transparent) 100%)`,
      }}
    />
  );
}

/**
 * Header block: [mark] name / domain / caller-supplied status chips.
 * The eyebrow keeps the Trust Tai frame visible above the company subject.
 */
export function CompanyIdentityHeader({
  name,
  websiteUrl,
  themeColor,
  logoUrl,
  eyebrow,
  status,
}: CompanyIdentityProps & { eyebrow?: string; status?: React.ReactNode }) {
  const host = hostnameOf(websiteUrl);
  return (
    <div className="flex min-w-0 items-start gap-4">
      <CompanyMark
        name={name}
        websiteUrl={websiteUrl}
        themeColor={themeColor ?? null}
        logoUrl={logoUrl ?? null}
        size="lg"
        className="mt-1"
      />
      <div className="min-w-0">
        {eyebrow ? (
          <p className="tt-eyebrow flex items-center gap-2">
            {eyebrow}
            <CompanyAccentDot themeColor={themeColor ?? null} />
          </p>
        ) : null}
        <h1 className="tt-display mt-2 text-3xl text-foreground lg:text-4xl">{name}</h1>
        <p className="mt-2 font-mono text-[12px] text-muted-foreground">
          {host ? (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {host}
              <ExternalLink aria-hidden className="size-3" />
            </a>
          ) : (
            "No website recorded"
          )}
        </p>
        {status ? <div className="mt-4 flex flex-wrap items-center gap-3">{status}</div> : null}
      </div>
    </div>
  );
}
