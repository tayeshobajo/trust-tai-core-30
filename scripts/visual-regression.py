#!/usr/bin/env python3
"""
Trust Tai OS — visual regression sweep (browser half).

Renders the key OS screens at three breakpoints and checks the three things
branding drifts on first: the official logo lockup, the typography hierarchy,
and the colour tokens. Screenshots are written per screen/breakpoint and, when
a baseline exists, compared pixel-wise so a layout change is visible too.

    python3 scripts/visual-regression.py                 # check against baselines
    python3 scripts/visual-regression.py --update        # (re)write baselines
    python3 scripts/visual-regression.py --base-url ...  # default http://localhost:8080

Signed-out rooms render their fail-closed preview, which still carries the full
shell branding — so the sweep needs no session.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".visual" / "current"
BASELINE = ROOT / ".visual" / "baseline"

SCREENS = [
    ("auth", "/auth?redirect=%2F"),
    ("home", "/"),
    ("scout", "/modules/scout"),
    ("conductor", "/modules/conductor"),
    ("pulse", "/modules/pulse"),
]

BREAKPOINTS = [
    ("mobile", 375, 900),
    ("tablet", 768, 1100),
    ("desktop", 1440, 1200),
]

LOGO_ASPECT = 534 / 97
ASPECT_TOLERANCE = 0.02
# Rendered logo height bounds across the shell, gate and sign-in screens.
LOGO_HEIGHT_RANGE = (20, 64)
PIXEL_DIFF_TOLERANCE = 0.005  # 0.5% of pixels may differ

PROBE = """
() => {
  const root = getComputedStyle(document.documentElement);
  const token = (n) => root.getPropertyValue(n).trim();
  const logos = [...document.querySelectorAll('img[alt="Trust Tai"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, src: el.currentSrc || el.src, complete: el.complete && el.naturalWidth > 0 };
  });
  const seen = new Map();
  for (const el of document.querySelectorAll('h1, h2, h3, p, .tt-eyebrow')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const key = el.tagName.toLowerCase() + '|' + cs.fontFamily.split(',')[0].replace(/["']/g, '');
    if (!seen.has(key)) {
      seen.set(key, { tag: el.tagName.toLowerCase(), family: cs.fontFamily.split(',')[0].replace(/["']/g, ''), size: parseFloat(cs.fontSize), color: cs.color });
    }
  }
  return {
    tokens: {
      ink: token('--ink'), paper: token('--paper'), royal: token('--royal'),
      rule: token('--rule'), cloud: token('--cloud'), card: token('--card'),
      ember: token('--ember'), danger: token('--danger'),
      scout: token('--tt-app-scout'), pulse: token('--tt-app-pulse'),
    },
    body: {
      background: getComputedStyle(document.body).backgroundColor,
      color: getComputedStyle(document.body).color,
      family: getComputedStyle(document.body).fontFamily.split(',')[0].replace(/["']/g, ''),
    },
    logos,
    type: [...seen.values()],
  };
}
"""

EXPECTED_TOKENS = {
    "ink": "oklch(0.19 0.048 266)",
    "paper": "oklch(1 0 0)",
    "royal": "oklch(0.49 0.185 264)",
    "rule": "oklch(0.906 0.016 250)",
    "cloud": "oklch(0.974 0.012 250)",
    "card": "oklch(1 0 0)",
    "ember": "oklch(0.62 0.16 45)",
    "danger": "oklch(0.52 0.19 27)",
    "scout": "#2aafc8",
    "pulse": "#8a5c92",
}

SERIF = "Cormorant Garamond"
SANS = "Inter"
MONO = "JetBrains Mono"


def norm_color(value: str) -> str:
    """CSS serialises oklch as `oklch(19% .048 266)`; compare on numbers, not text."""
    v = value.strip().lower()
    if not v.startswith("oklch("):
        return v
    parts = v[6:-1].replace("/", " ").split()
    out = []
    for part in parts:
        num = part[:-1] if part.endswith("%") else part
        try:
            f = float(num) / 100 if part.endswith("%") else float(num)
        except ValueError:
            out.append(part)
            continue
        out.append(f"{f:g}")
    return "oklch(" + " ".join(out) + ")"


def check_probe(screen: str, bp: str, data: dict) -> list[str]:
    fails: list[str] = []
    where = f"{screen}@{bp}"

    for name, expected in EXPECTED_TOKENS.items():
        actual = data["tokens"].get(name, "")
        if norm_color(actual) != norm_color(expected):
            fails.append(f"{where}: token --{name} is '{actual}', expected '{expected}'")

    if data["body"]["family"] != SANS:
        fails.append(f"{where}: body font is {data['body']['family']}, expected {SANS}")

    if not data["logos"]:
        fails.append(f"{where}: no Trust Tai logo rendered")
    for logo in data["logos"]:
        if not logo["complete"]:
            fails.append(f"{where}: logo failed to load ({logo['src']})")
        if logo["height"] <= 0:
            continue
        aspect = logo["width"] / logo["height"]
        if abs(aspect - LOGO_ASPECT) / LOGO_ASPECT > ASPECT_TOLERANCE:
            fails.append(f"{where}: logo aspect {aspect:.3f}, expected {LOGO_ASPECT:.3f}")
        if not LOGO_HEIGHT_RANGE[0] <= logo["height"] <= LOGO_HEIGHT_RANGE[1]:
            fails.append(f"{where}: logo height {logo['height']:.1f}px out of range")
        if "trust-tai-logo" not in logo["src"]:
            fails.append(f"{where}: logo src is not the official lockup ({logo['src']})")

    headings = [t for t in data["type"] if t["tag"] in ("h1", "h2")]
    if headings and not any(t["family"] == SERIF for t in headings):
        fails.append(f"{where}: no serif ({SERIF}) heading found")
    for t in data["type"]:
        if t["family"] not in (SERIF, SANS, MONO):
            fails.append(f"{where}: <{t['tag']}> uses off-brand family {t['family']}")
        if t["tag"] in ("h1", "h2") and t["family"] == SERIF and not 26 <= t["size"] <= 56:
            fails.append(f"{where}: display size {t['size']}px outside 26-56px")
        if t["tag"] == "p" and t["family"] == SANS and not 12 <= t["size"] <= 20:
            fails.append(f"{where}: body size {t['size']}px outside 12-20px")
        if t["family"] == MONO and not 9 <= t["size"] <= 13:
            fails.append(f"{where}: eyebrow size {t['size']}px outside 9-13px")

    return fails


def compare(current: Path, baseline: Path) -> str | None:
    if not baseline.exists():
        return None
    a, b = Image.open(current).convert("RGB"), Image.open(baseline).convert("RGB")
    if a.size != b.size:
        return f"size changed {b.size} -> {a.size}"
    diff = ImageChops.difference(a, b).convert("L")
    changed = sum(1 for px in diff.getdata() if px > 12)
    ratio = changed / (a.size[0] * a.size[1])
    if ratio > PIXEL_DIFF_TOLERANCE:
        return f"{ratio * 100:.2f}% of pixels changed"
    return None


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8080")
    parser.add_argument("--update", action="store_true", help="write baselines instead of comparing")
    args = parser.parse_args()

    target = BASELINE if args.update else OUT
    target.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    report: dict[str, dict] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        for bp, width, height in BREAKPOINTS:
            context = await browser.new_context(viewport={"width": width, "height": height})
            page = await context.new_page()
            for screen, path in SCREENS:
                url = args.base_url + path
                await page.goto(url, wait_until="networkidle")
                await page.wait_for_timeout(400)
                data = await page.evaluate(PROBE)
                report[f"{screen}@{bp}"] = data
                failures += check_probe(screen, bp, data)

                shot = target / f"{screen}-{bp}.png"
                await page.screenshot(path=str(shot))
                if not args.update:
                    drift = compare(shot, BASELINE / f"{screen}-{bp}.png")
                    if drift:
                        failures.append(f"{screen}@{bp}: pixel drift — {drift}")
            await context.close()
        await browser.close()

    (target / "report.json").write_text(json.dumps(report, indent=2))

    if args.update:
        print(f"baselines written to {BASELINE}")
        return 0
    if failures:
        print("VISUAL REGRESSION FAILURES:")
        for f in failures:
            print("  -", f)
        return 1
    print(f"visual regression clean: {len(SCREENS) * len(BREAKPOINTS)} screens checked")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
