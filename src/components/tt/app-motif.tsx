import type { CSSProperties } from "react";
import type React from "react";

import type { AppMotif } from "@/domain/app-theme";
import { cn } from "@/lib/utils";

/**
 * Abstract editorial motifs, drawn in CSS/SVG.
 *
 * These are atmosphere and orientation, not decoration. Each occupies the same
 * frame, so art-directed photography can replace a motif later without any
 * layout change.
 */

function Horizon() {
  return (
    <g>
      <line x1="0" y1="150" x2="400" y2="150" stroke="currentColor" strokeWidth="1" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <line
          key={i}
          x1={-120 + i * 90}
          y1="260"
          x2={160 + i * 14}
          y2="150"
          stroke="currentColor"
          strokeWidth="0.6"
          opacity={0.5}
        />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={`h${i}`}
          x1="0"
          y1={150 + Math.pow(i + 1, 2) * 4.4}
          x2="400"
          y2={150 + Math.pow(i + 1, 2) * 4.4}
          stroke="currentColor"
          strokeWidth="0.6"
          opacity={0.35}
        />
      ))}
      <circle cx="272" cy="150" r="34" fill="currentColor" opacity={0.08} />
      <circle cx="272" cy="150" r="34" stroke="currentColor" strokeWidth="0.8" fill="none" />
    </g>
  );
}

function Terrain() {
  return (
    <g>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path
          key={i}
          d={`M-20 ${210 - i * 24} C 70 ${170 - i * 26}, 140 ${240 - i * 20}, 220 ${190 - i * 24} S 340 ${150 - i * 22}, 420 ${196 - i * 24}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.7"
          opacity={0.55 - i * 0.06}
        />
      ))}
      <circle cx="150" cy="112" r="26" stroke="currentColor" strokeWidth="0.9" fill="none" />
      <circle cx="212" cy="112" r="26" stroke="currentColor" strokeWidth="0.9" fill="none" />
      <line x1="176" y1="112" x2="186" y2="112" stroke="currentColor" strokeWidth="0.9" />
      <circle cx="150" cy="112" r="7" fill="currentColor" opacity={0.18} />
      <circle cx="212" cy="112" r="7" fill="currentColor" opacity={0.18} />
    </g>
  );
}

function Correspondence() {
  return (
    <g>
      <rect x="44" y="60" width="180" height="128" rx="6" stroke="currentColor" strokeWidth="0.8" fill="none" />
      <rect x="72" y="86" width="180" height="128" rx="6" stroke="currentColor" strokeWidth="0.8" fill="none" opacity={0.7} />
      <rect x="100" y="112" width="180" height="128" rx="6" fill="currentColor" opacity={0.05} />
      <rect x="100" y="112" width="180" height="128" rx="6" stroke="currentColor" strokeWidth="0.9" fill="none" />
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1="120"
          y1={142 + i * 20}
          x2={i % 2 === 0 ? 258 : 216}
          y2={142 + i * 20}
          stroke="currentColor"
          strokeWidth="0.7"
          opacity={0.5}
        />
      ))}
      <circle cx="320" cy="96" r="18" stroke="currentColor" strokeWidth="0.8" fill="none" />
    </g>
  );
}

function Contour() {
  return (
    <g>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <ellipse
          key={i}
          cx={200 - i * 6}
          cy="150"
          rx={30 + i * 26}
          ry={18 + i * 16}
          stroke="currentColor"
          strokeWidth="0.7"
          fill="none"
          opacity={0.5 - i * 0.045}
        />
      ))}
      <path
        d="M40 232 C 120 210, 130 132, 196 128 S 300 96, 366 62"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeDasharray="1 7"
        strokeLinecap="round"
      />
      {[
        [40, 232],
        [196, 128],
        [366, 62],
      ].map(([x, y]) => (
        <circle key={`${x}`} cx={x} cy={y} r="5" fill="currentColor" />
      ))}
    </g>
  );
}

function Blueprint() {
  return (
    <g>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <line key={`v${i}`} x1={40 + i * 44} y1="46" x2={40 + i * 44} y2="254" stroke="currentColor" strokeWidth="0.4" opacity={0.3} />
      ))}
      {[0, 1, 2, 3, 4].map((i) => (
        <line key={`h${i}`} x1="40" y1={46 + i * 52} x2="348" y2={46 + i * 52} stroke="currentColor" strokeWidth="0.4" opacity={0.3} />
      ))}
      <rect x="84" y="98" width="132" height="108" fill="currentColor" opacity={0.06} />
      <rect x="84" y="98" width="132" height="108" stroke="currentColor" strokeWidth="1" fill="none" />
      <rect x="216" y="150" width="88" height="56" stroke="currentColor" strokeWidth="1" fill="none" />
      <line x1="84" y1="82" x2="216" y2="82" stroke="currentColor" strokeWidth="0.7" />
      <line x1="84" y1="76" x2="84" y2="88" stroke="currentColor" strokeWidth="0.7" />
      <line x1="216" y1="76" x2="216" y2="88" stroke="currentColor" strokeWidth="0.7" />
    </g>
  );
}

function Systems() {
  return (
    <g>
      {[100, 150, 200].map((y, row) => (
        <g key={y}>
          <line x1="60" y1={y} x2="340" y2={y} stroke="currentColor" strokeWidth="0.6" opacity={0.4} />
          {[0, 1, 2, 3, 4].map((i) => (
            <circle
              key={i}
              cx={72 + i * 64}
              cy={y}
              r={row === 1 && i === 2 ? 9 : 4.5}
              fill="currentColor"
              opacity={row === 1 && i === 2 ? 0.2 : 0.55}
            />
          ))}
        </g>
      ))}
      <circle cx="200" cy="150" r="9" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <rect x="52" y="72" width="296" height="156" rx="10" stroke="currentColor" strokeWidth="0.7" fill="none" opacity={0.6} />
    </g>
  );
}

function Composition() {
  return (
    <g>
      <rect x="52" y="56" width="150" height="188" stroke="currentColor" strokeWidth="0.9" fill="none" />
      <rect x="52" y="56" width="150" height="96" fill="currentColor" opacity={0.07} />
      <text x="66" y="200" fill="currentColor" opacity={0.65} fontFamily="serif" fontSize="54">
        Aa
      </text>
      <rect x="222" y="86" width="126" height="126" stroke="currentColor" strokeWidth="0.9" fill="none" />
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1="238" y1={168 + i * 14} x2={i % 2 ? 300 : 332} y2={168 + i * 14} stroke="currentColor" strokeWidth="0.7" opacity={0.5} />
      ))}
      <circle cx="284" cy="126" r="18" stroke="currentColor" strokeWidth="0.8" fill="none" />
    </g>
  );
}

function Rhythm() {
  const bars = [46, 78, 58, 104, 88, 132, 96, 148, 118, 164, 140, 186];
  return (
    <g>
      <line x1="40" y1="226" x2="360" y2="226" stroke="currentColor" strokeWidth="0.7" />
      {bars.map((h, i) => (
        <line
          key={i}
          x1={56 + i * 26}
          y1="226"
          x2={56 + i * 26}
          y2={226 - h}
          stroke="currentColor"
          strokeWidth={i === bars.length - 1 ? 2.4 : 1.2}
          opacity={i === bars.length - 1 ? 1 : 0.4}
          strokeLinecap="round"
        />
      ))}
      <path
        d={`M56 ${226 - bars[0]!} ${bars.map((h, i) => `L${56 + i * 26} ${226 - h}`).join(" ")}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="0.9"
        opacity={0.7}
      />
    </g>
  );
}

const MOTIFS: Record<AppMotif, () => React.ReactElement> = {
  horizon: Horizon,
  terrain: Terrain,
  correspondence: Correspondence,
  contour: Contour,
  blueprint: Blueprint,
  systems: Systems,
  composition: Composition,
  rhythm: Rhythm,
};

export function AppMotifArt({
  motif,
  tint,
  className,
}: {
  motif: AppMotif;
  tint: string;
  className?: string;
}) {
  const Motif = MOTIFS[motif];
  return (
    <svg
      viewBox="0 0 400 300"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
      className={cn("h-full w-full", className)}
      style={{ color: tint } as CSSProperties}
    >
      <Motif />
    </svg>
  );
}
