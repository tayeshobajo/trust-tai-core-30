/**
 * Trust Tai OS — Home featured imagery.
 *
 * One bundled photograph per room, all from the same Trust Tai world:
 * luminous architecture, warm white stone, open horizons, morning light.
 * Bundled as ES imports so a room card can never render a broken file.
 */

import commsImg from "@/assets/home/comms.jpg";
import conductorImg from "@/assets/home/conductor.jpg";
import heroImg from "@/assets/home/hero.jpg";
import opsImg from "@/assets/home/ops.jpg";
import projectsImg from "@/assets/home/projects.jpg";
import pulseImg from "@/assets/home/pulse.jpg";
import roadmapImg from "@/assets/home/roadmap.jpg";
import scoutImg from "@/assets/home/scout.jpg";
import stewardImg from "@/assets/home/steward.jpg";
import studioImg from "@/assets/home/studio.jpg";

export const HOME_HERO_IMAGE = heroImg;

export interface RoomFeature {
  image: string;
  /** One short human sentence: what this room is for. */
  line: string;
  /** Described by the room name beside it, so the image itself is decorative. */
  alt: string;
}

export const ROOM_FEATURES: Record<string, RoomFeature> = {
  scout: {
    image: scoutImg,
    line: "Discover signals and what matters.",
    alt: "An open observation deck looking out over a bright horizon",
  },
  comms: {
    image: commsImg,
    line: "Have the right conversations.",
    alt: "A circular stone gathering space open to the sky",
  },
  roadmap: {
    image: roadmapImg,
    line: "Align strategy and sequence work.",
    alt: "A long pale pathway running toward a distant horizon",
  },
  projects: {
    image: projectsImg,
    line: "Deliver with clarity and focus.",
    alt: "Broad ascending stone steps in a structured courtyard",
  },
  steward: {
    image: stewardImg,
    line: "Guard trust, memory, and alignment.",
    alt: "A sheltered garden courtyard with a still reflecting pool",
  },
  ops: {
    image: opsImg,
    line: "Run operations with excellence.",
    alt: "Calm water channels beside precise pale infrastructure",
  },
  studio: {
    image: studioImg,
    line: "Create content and assets.",
    alt: "A bright empty pavilion filled with morning light",
  },
  pulse: {
    image: pulseImg,
    line: "See activity and understand impact.",
    alt: "A luminous rotunda open to a circle of blue sky",
  },
  conductor: {
    image: conductorImg,
    line: "Orchestrate decisions and actions.",
    alt: "A central hall with a circular patterned stone floor",
  },
};

export function getRoomFeature(appId: string): RoomFeature | undefined {
  return ROOM_FEATURES[appId];
}
