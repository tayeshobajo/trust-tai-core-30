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

  it("uses the compact shared header and keeps all five destinations plus New draft", () => {
    expect(tabs).toContain("export function CommsPageHeader");
    for (const label of ["Dashboard", "Conversations", "Drafts & Reviews", "Voice DNA", "Connections"]) {
      expect(tabs).toContain(`label: "${label}"`);
    }
    expect(tabs).toContain("New draft");
    expect(tabs).toContain("overflow-x-auto");
  });

  it("keeps Dashboard cards content-sized and uses the reviewed copy", () => {
    expect(dashboard).toContain("columns-1");
    expect(dashboard).toContain("break-inside-avoid");
    expect(dashboard).toContain('note="Ready for review."');
    expect(dashboard).not.toContain("Held at the human boundary.");
  });

  it("applies the opaque primary surface to all real Comms workspaces", () => {
    for (const source of [dashboard, conversations, drafts, voice, connections]) {
      expect(source).toContain("comms-card");
    }
  });

  it("does not create a second main landmark inside the shared shell", () => {
    expect(conversations).not.toMatch(/<main[\s>]/);
  });
});