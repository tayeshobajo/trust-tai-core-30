import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
const css = readFileSync("src/components/tt/cmd/tokens.css", "utf8");
import { CmdAction } from "./action";
import { RfpStageBadge } from "../rfps/stage-badge";
import { stages, stageLabel } from "@/domain/rfps";
afterEach(cleanup);
const token = (name: string) => css.match(new RegExp(`--cmd-${name}:\\s*(#[0-9a-f]{6})`))![1]!;
function luminance(hex: string) {
  const c = hex
    .slice(1)
    .match(/../g)!
    .map((x) => parseInt(x, 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
it("keeps every status label at AA normal-text contrast", () => {
  for (const stage of stages)
    expect(
      contrast(token(`status-${stage}-text`), token(`status-${stage}-bg`)),
      stage,
    ).toBeGreaterThanOrEqual(4.5);
});
it("keeps action text readable across default, hover, active and disabled states", () => {
  for (const variant of ["primary", "secondary", "tertiary"]) {
    const foreground = token(
      variant === "primary" ? "action-on-primary" : `action-${variant}-text`,
    );
    for (const suffix of ["", "-hover", "-active"])
      expect(
        contrast(foreground, token(`action-${variant}${suffix}`)),
        `${variant}${suffix}`,
      ).toBeGreaterThanOrEqual(4.5);
  }
  expect(
    contrast(token("action-disabled-text"), token("action-disabled-bg")),
  ).toBeGreaterThanOrEqual(4.5);
  for (const surface of ["#ffffff", "#f1f5f9", "#eff6ff"]) {
    expect(contrast(token("focus"), surface)).toBeGreaterThanOrEqual(3);
    expect(contrast(token("action-border"), surface)).toBeGreaterThanOrEqual(3);
  }
});
it("preserves native disabled and pending behavior without accidental form submission", () => {
  const click = vi.fn();
  render(
    <>
      <CmdAction onClick={click}>Open</CmdAction>
      <CmdAction disabled onClick={click}>
        Disabled
      </CmdAction>
      <CmdAction pending pendingLabel="Saving…" onClick={click}>
        Save
      </CmdAction>
    </>,
  );
  expect(screen.getByRole("button", { name: "Open" }).getAttribute("type")).toBe("button");
  fireEvent.click(screen.getByRole("button", { name: "Disabled" }));
  fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
  expect(click).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Saving…" }).getAttribute("aria-busy")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(click).toHaveBeenCalledTimes(1);
});
it("retains a visible exact stage label and hides decorative icons from screen readers", () => {
  const { container } = render(
    <>
      {stages.map((stage) => (
        <RfpStageBadge key={stage} stage={stage} />
      ))}
    </>,
  );
  for (const stage of stages) expect(screen.getByText(stageLabel[stage])).toBeTruthy();
  for (const icon of container.querySelectorAll("svg"))
    expect(icon.getAttribute("aria-hidden")).toBe("true");
});
