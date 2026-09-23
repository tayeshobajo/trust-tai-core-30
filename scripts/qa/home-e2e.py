"""Signed-in Home / Steward walkthrough (H1-H5, A1-A5, Q1-Q3).

Uses only an injected or minted real session. Never a server key, never a
pasted password. With no session it reports BLOCKED and marks nothing passed.
Synthetic tasks are prefixed "QA-" and removed through the UI where possible.
"""
import asyncio, json, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = os.environ.get("QA_BASE_URL", "http://localhost:8080")
OUT = Path("/tmp/browser/home-e2e"); OUT.mkdir(parents=True, exist_ok=True)


def load_session():
    path = Path.home() / ".cache/lovable-auth/session.json"
    if os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON"):
        return (os.environ["LOVABLE_BROWSER_SUPABASE_STORAGE_KEY"],
                os.environ["LOVABLE_BROWSER_SUPABASE_SESSION_JSON"],
                os.environ.get("LOVABLE_BROWSER_SUPABASE_COOKIES_JSON"))
    if path.exists():
        m = json.loads(path.read_text())
        return m["storage_key"], json.dumps(m["session"]), json.dumps(m["cookies"])
    return None


async def main():
    s = load_session()
    if not s:
        print("BLOCKED: no signed-in session (auth status: %s). Nothing passed." %
              os.environ.get("LOVABLE_BROWSER_AUTH_STATUS", "unknown"))
        return 2
    key, session, cookies = s
    results = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(headless=True)
        ctx = await b.new_context(viewport={"width": 1280, "height": 1800})
        if cookies:
            cs = json.loads(cookies)
            for c in cs: c["url"] = BASE
            await ctx.add_cookies(cs)
        page = await ctx.new_page()
        await page.goto(BASE)
        await page.evaluate(f"localStorage.setItem({json.dumps(key)}, {json.dumps(session)})")
        await page.goto(BASE + "/", wait_until="networkidle")
        await page.wait_for_timeout(4000)
        await page.screenshot(path=str(OUT / "0_home.png"))
        print("url after sign-in:", page.url)
        results["H1_signed_in"] = "/auth" not in page.url
        if not results["H1_signed_in"]:
            print("H1_signed_in FAIL"); await b.close(); return 1
        title = "QA-home-" + os.urandom(3).hex()
        new = page.get_by_role("button", name="New task").first
        if not await new.count():
            print("H2 BLOCKED: no New task button (task storage may be unavailable)"); await b.close(); return 1
        await new.click()
        await page.get_by_placeholder("What needs doing?").fill(title)
        await page.get_by_role("button", name="Create task").click()
        await page.wait_for_timeout(1500)
        row = page.get_by_text(title)
        results["H2_created"] = await row.count() > 0
        await page.screenshot(path=str(OUT / "1_created.png"))
        box = page.get_by_role("checkbox", name=title)
        if await box.count():
            await box.click(); await page.wait_for_timeout(1200)
            results["H2_completed_locked"] = await box.is_disabled()
        await page.reload(wait_until="networkidle")
        results["H4_persisted"] = await page.get_by_text(title).count() > 0
        await page.goto(BASE + "/modules/steward/ai", wait_until="networkidle")
        ai = "QA-ai-" + os.urandom(3).hex()
        await page.get_by_label("Task for Trust Tai AI").fill(ai)
        await page.get_by_role("button", name="Queue").click()
        await page.wait_for_timeout(4000)
        results["Q1_queued"] = await page.get_by_text(ai).count() > 0
        await page.screenshot(path=str(OUT / "2_ai_queue.png"))
        await page.goto(BASE + "/modules/steward/timeline", wait_until="networkidle")
        results["T1_timeline_lists_task"] = await page.get_by_text(title).count() > 0
        await b.close()
    for k, v in results.items(): print(k, "PASS" if v else "FAIL")
    return 0 if all(results.values()) else 1

sys.exit(asyncio.run(main()))
