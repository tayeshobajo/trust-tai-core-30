import { expect, it } from "vitest";
import { Route as root } from "./modules.comms.index";
import { Route as dashboard } from "./modules.comms.dashboard";
import { Route as conversations } from "./modules.comms.conversations";
it.each([root, dashboard, conversations])(
  "redirects legacy entries preserving exact record focus",
  (route) => {
    const search = { relationship: "person", thread: "subject", message: "email" };
    let thrown: unknown;
    try {
      (route.options.beforeLoad as unknown as (context: { search: typeof search }) => unknown)({
        search,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      options: { to: "/modules/comms/relationships", search, replace: true },
    });
  },
);
