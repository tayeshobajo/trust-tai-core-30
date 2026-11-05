import type { ComponentProps } from "react";
import { TTButton } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";
import "./components.css";
export type CmdActionProps = Omit<ComponentProps<typeof TTButton>, "variant" | "size"> & {
  variant?: "primary" | "secondary" | "tertiary";
  fullWidth?: boolean;
};
/** Opt-in CMD action hierarchy; retains TTButton pending and native button semantics. */
export function CmdAction({
  variant = "secondary",
  fullWidth = false,
  className,
  type = "button",
  ...props
}: CmdActionProps) {
  return (
    <TTButton
      {...props}
      type={type}
      variant="secondary"
      data-variant={variant}
      className={cn("cmd-action", fullWidth && "cmd-action-full", className)}
    />
  );
}
