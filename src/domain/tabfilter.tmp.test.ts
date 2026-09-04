import { describe, expect, it } from "vitest";
import { tabFilter, tabFor, CATEGORY_TAB_LABEL } from "@/domain/approvals";
const apps = ["scout","comms","roadmap","website","projects","ops","studio","content"] as const;
const cats = ["marketing","communication","qualification","strategy","delivery","creative","operations"] as const;
describe("tabFilter", () => {
  it("agrees with tabFor everywhere", () => {
    for (const tab of ["marketing","comms","scout","roadmap","delivery"] as const) {
      const f = tabFilter(tab);
      for (const sourceApp of apps) for (const category of cats) {
        const inFilter = f.sourceApps.includes(sourceApp) || (f.otherApps.includes(sourceApp) && f.categories.includes(category));
        expect([tab, sourceApp, category, inFilter]).toEqual([tab, sourceApp, category, tabFor({sourceApp, category}) === tab]);
      }
    }
    expect(CATEGORY_TAB_LABEL.all).toBe("All");
  });
});
