import { useEffect, useRef, useState } from "react";

import { AppMotifArt } from "@/components/tt/app-motif";
import { getAppImage } from "@/domain/app-imagery";
import { getAppTheme } from "@/domain/app-theme";
import { cn } from "@/lib/utils";

/**
 * Atmospheric artwork for a registered app.
 *
 * The SVG motif is always rendered as the base layer. The manifest photograph
 * is layered on top and only becomes visible once the browser confirms it
 * loaded; a missing or failed file simply leaves the motif in place.
 *
 * Artwork is never placed behind dense copy — callers give it its own frame.
 */
export function AppArtwork({
  appId,
  className,
  scrim = "none",
  motifClassName,
}: {
  appId: string;
  className?: string;
  /** Readability treatment when text sits over the frame. */
  scrim?: "none" | "soft" | "strong";
  motifClassName?: string;
}) {
  const theme = getAppTheme(appId);
  const image = getAppImage(appId);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const ref = useRef<HTMLImageElement | null>(null);

  // The server-rendered <img> can finish loading before React attaches its
  // handlers, so check the element directly after mount as well.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (!el.complete) return;
      if (el.naturalWidth > 0) setLoaded(true);
      else setFailed(true);
    };
    check();
    el.addEventListener("load", check);
    el.addEventListener("error", check);
    return () => {
      el.removeEventListener("load", check);
      el.removeEventListener("error", check);
    };
  }, [image?.src]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden", className)}>
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-500",
          loaded ? "opacity-0" : "opacity-70",
        )}
      >
        <AppMotifArt motif={theme.motif} tint={theme.tint} {...(motifClassName ? { className: motifClassName } : {})} />
      </div>

      {image && !failed ? (
        <img
          src={image.src}
          alt={image.alt}
          aria-hidden={image.alt === "" ? true : undefined}
          ref={ref}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          style={{ objectPosition: image.objectPosition }}
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
            loaded ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}

      {scrim !== "none" && loaded ? (
        <div
          aria-hidden
          className={cn(
            "absolute inset-0",
            scrim === "soft"
              ? "bg-gradient-to-t from-card/80 via-card/20 to-transparent"
              : "bg-gradient-to-r from-card via-card/80 to-card/30",
          )}
        />
      ) : null}
    </div>
  );
}
