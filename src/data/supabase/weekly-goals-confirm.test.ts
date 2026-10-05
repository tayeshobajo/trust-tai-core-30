import { describe, it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), eq: vi.fn(), single: vi.fn() }));
vi.mock("@/integrations/trust-tai/supabase", () => ({
  supabase: { auth: { getUser: mock.getUser }, from: mock.from },
}));
import { weeklyGoals } from "./weekly-goals";
beforeEach(() => {
  vi.resetAllMocks();
  const chain = {
    update: (): unknown => chain,
    eq: mock.eq,
    select: (): unknown => chain,
    single: mock.single,
  };
  mock.eq.mockReturnValue(chain);
  mock.from.mockReturnValue(chain);
});
describe("goal confirmation client defense (database trigger tested separately)", () => {
  it("refuses signed out before any update", async () => {
    mock.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(weeklyGoals.confirm("goal")).rejects.toThrow(/Sign in/);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it("constrains update to the verified user and proposed status", async () => {
    mock.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
    mock.single.mockResolvedValue({ data: { id: "goal", status: "confirmed" }, error: null });
    await weeklyGoals.confirm("goal");
    expect(mock.eq).toHaveBeenCalledWith("owner_user_id", "verified-user");
    expect(mock.eq).toHaveBeenCalledWith("status", "proposed");
  });
  it("does not turn a denied update into successful confirmation", async () => {
    mock.getUser.mockResolvedValue({ data: { user: { id: "verified-user" } }, error: null });
    mock.single.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "Permission denied" },
    });
    await expect(weeklyGoals.confirm("goal")).rejects.toThrow(/Permission denied/);
  });
});
