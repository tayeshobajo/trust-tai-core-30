import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("personal dashboard placement", () => {
  const home = readFileSync("src/routes/index.tsx", "utf8");
  const welcome = readFileSync("src/routes/welcome.tsx", "utf8");
  const stewardDashboard = readFileSync("src/routes/modules.steward.dashboard.tsx", "utf8");
  const stewardTabs = readFileSync("src/components/tt/steward/steward-tabs.tsx", "utf8");
  const shell = readFileSync("src/components/tt/app-shell.tsx", "utf8");

  it("renders the signed-in personal operating dashboard at Home", () => {
    expect(home).toContain('<WorkspaceGate appId="home">');
    expect(home).toContain("<PersonalDashboard identity={identity} />");
    expect(home).not.toContain("<HomeHero");
  });

  it("preserves the welcome overview at its own route", () => {
    expect(welcome).toContain('createFileRoute("/welcome")');
    expect(welcome).toContain("<HomeHero");
  });

  it("takes the logo to the welcome overview", () => {
    expect(shell).toContain('<Link to="/welcome"');
    expect(shell).toContain('aria-label="Trust Tai OS · welcome"');
    expect(shell).toContain('pathname === "/" || pathname === "/welcome"');
  });

  it("redirects the old personal Steward address to Home", () => {
    expect(stewardDashboard).toContain('redirect({ to: "/", replace: true })');
    expect(stewardDashboard).not.toContain("<PersonDashboard");
  });

  it("keeps Steward focused on its team and accountability sections", () => {
    expect(stewardTabs).not.toContain("Your dashboard");
    expect(stewardTabs).not.toContain('active === "dashboard"');
    expect(stewardTabs).toContain('to="/modules/steward"');
    expect(stewardTabs).toContain('to="/modules/steward/meetings"');
    expect(stewardTabs).toContain('to="/modules/steward/tasks"');
  });
});