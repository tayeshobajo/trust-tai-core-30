import { StudioSectionNav } from "./studio-shell";
export function StudioNav({ current }: { current: "content" | "audience" }) {
  return <StudioSectionNav current={current === "audience" ? "People" : "Posts"} />;
}
