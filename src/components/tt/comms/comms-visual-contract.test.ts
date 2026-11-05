import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const styles = read("src/styles.css");
const tabs = read("src/components/tt/comms/comms-tabs.tsx");
const dashboard = read("src/routes/modules.comms.index.tsx");
const conversations = read("src/routes/modules.comms.relationships.tsx");
const drafts = read("src/components/tt/comms/drafts-workspace.tsx");
const voice = read("src/routes/modules.comms.voice.tsx");
const connections = read("src/components/tt/comms/integrations-panel.tsx");

describe("Comms white-card visual contract", () => {
  it("defines one opaque, border-led Comms surface without a shadow", () => {
    expect(styles).toMatch(
      /@utility comms-card\s*\{[\s\S]*background-color: var\(--card\);[\s\S]*border: 1px solid var\(--border\);[\s\S]*border-radius: var\(--radius-2xl\);[\s\S]*box-shadow: none;/,
    );
  });

  it("uses the shared header, three primary destinations and secondary records", () => {
    expect(tabs).toContain("export function CommsPageHeader");
    for (const label of [
      "Conversations",
      "Voice DNA",
      "Accounts & Connections",
      "Saved writing",
      "Communication records",
    ]) {
      expect(tabs).toContain(`label: "${label}"`);
    }
    expect(tabs).toContain("New Message");
    expect(tabs).not.toContain("Templates");
    expect(tabs).toContain("overflow-x-auto");
  });

  it("redirects the former Dashboard into Conversations and removes Dashboard navigation", () => {
    expect(dashboard).toContain('to: "/modules/comms/relationships"');
    expect(dashboard).toContain("validateSearch: conversationSearch");
    expect(tabs).not.toContain('label: "Dashboard"');
    expect(tabs).not.toContain("                Dashboard");
  });

  it("applies the opaque primary surface to all real Comms workspaces", () => {
    for (const source of [conversations, drafts, voice, connections]) {
      expect(source).toContain("comms-card");
    }
  });

  it("uses the same shell on settings, records and legacy work routes", () => {
    for (const route of ["integrations", "voice", "drafts", "history", "plan", "inbox", "to-scout"]) {
      const source = read(`src/routes/modules.comms.${route}.tsx`);
      expect(source).toContain("<CommsPageShell identity={identity}>");
      expect(source).not.toContain("<AppShell");
    }
    const shell = read("src/components/tt/comms/comms-page-shell.tsx");
    expect(shell).toContain('appearance="comms"');
    expect(shell).toContain('comms-workspace.css');
    expect(read("src/routes/modules.comms.review.tsx")).toContain('to: "/modules/comms/drafts"');
  });

  it("consumes the released CMD spacing foundation without redefining its scale", () => {
    const spacing = read("src/components/tt/workspace-spacing.css");
    expect(spacing).toContain('@import "./cmd/tokens.css"');
    expect(spacing).toContain('--workspace-gutter: var(--cmd-page-gutter)');
    expect(spacing).toContain('--workspace-bottom-space: var(--cmd-page-block-gap)');
    expect(spacing).not.toContain('@media');
  });

  it("does not create a second main landmark inside the shared shell", () => {
    expect(conversations).not.toMatch(/<main[\s>]/);
  });
});
