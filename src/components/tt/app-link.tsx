import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { AppRegistration } from "@/domain/registry";

/** Type-safe navigation to a registered app's route. */
export function AppLink({
  app,
  className,
  onClick,
  children,
  ...rest
}: {
  app: Pick<AppRegistration, "slug">;
  className?: string | undefined;
  onClick?: (() => void) | undefined;
  children: ReactNode;
  "aria-current"?: "page" | undefined;
}) {
  if (app.slug === "home") {
    return (
      <Link to="/" className={className} onClick={onClick} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <Link
      to="/modules/$slug"
      params={{ slug: app.slug }}
      className={className}
      onClick={onClick}
      {...rest}
    >
      {children}
    </Link>
  );
}
