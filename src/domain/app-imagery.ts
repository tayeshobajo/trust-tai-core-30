/**
 * Trust Tai OS — app imagery manifest.
 *
 * One explicit entry per registered app. The binaries are not in the project
 * yet: every surface that reads this manifest must render the SVG motif from
 * `app-theme` / `app-motif` as its base layer and only reveal the photograph
 * once it actually loads. A missing file must never break a screen.
 *
 * To activate an app's artwork, drop the PNG at the `src` path below
 * (`public/assets/...`). No code change is required.
 */

export interface AppImage {
  /** Public path served from `public/`. May not exist yet. */
  src: string;
  /** Decorative atmosphere: empty alt, described by the surrounding copy. */
  alt: string;
  /** Focal point kept visible when the frame crops on small screens. */
  objectPosition: string;
}

export const APP_IMAGERY: Record<string, AppImage> = {
  home: {
    src: "/assets/trust-tai-os-home.png",
    alt: "",
    objectPosition: "50% 45%",
  },
  scout: {
    src: "/assets/trust-tai-os-scout.png",
    alt: "",
    objectPosition: "55% 50%",
  },
  comms: {
    src: "/assets/trust-tai-os-comms.png",
    alt: "",
    objectPosition: "50% 50%",
  },
  roadmap: {
    src: "/assets/trust-tai-os-roadmap.png",
    alt: "",
    objectPosition: "50% 55%",
  },
  projects: {
    src: "/assets/trust-tai-os-projects.png",
    alt: "",
    objectPosition: "50% 50%",
  },
  ops: {
    src: "/assets/trust-tai-os-ops.png",
    alt: "",
    objectPosition: "50% 40%",
  },
  studio: {
    src: "/assets/trust-tai-os-studio.png",
    alt: "",
    objectPosition: "50% 50%",
  },
  pulse: {
    src: "/assets/trust-tai-os-pulse.png",
    alt: "",
    objectPosition: "50% 60%",
  },
};

export function getAppImage(appId: string): AppImage | undefined {
  return APP_IMAGERY[appId];
}
