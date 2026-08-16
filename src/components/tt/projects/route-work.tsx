/**
 * Ask Ops or Studio to take a bounded piece of this project's work.
 *
 * A route is a request. Nothing downstream is created here, and nothing is
 * claimed as accepted: Projects records that it asked, with the project's own
 * ids, evidence and boundary travelling with the ask.
 */

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import { SectionHeading, TTButton, TTInput } from "@/components/tt/primitives";
import { projectsService, type ProjectsContext } from "@/data/supabase/projects-service";
import type { AccessContext } from "@/domain/access";
import { can } from "@/domain/access";
import {
  ROUTE_TARGETS,
  ROUTE_TARGET_LABEL,
  type RouteTarget,
} from "@/domain/project-routing";
import type { ExecutionProject } from "@/domain/projects";

export function RouteWork({
  project,
  context,
  access,
}: {
  project: ExecutionProject;
  context: ProjectsContext;
  access: AccessContext;
}) {
  const [target, setTarget] = useState<RouteTarget>("ops");
  const [outcome, setOutcome] = useState("");
  const [because, setBecause] = useState("");
  const allowed = can(access, "projects.write");

  const route = useMutation({
    mutationFn: () =>
      projectsService.routeWork(
        project,
        {
          targetApp: target,
          requestedOutcome: outcome.trim(),
          because: because.trim(),
          requestedBy: {
            userId: context.userId,
            ...(context.userLabel ? { label: context.userLabel } : {}),
          },
        },
        context,
        access,
      ),
    onSuccess: () => {
      setOutcome("");
      setBecause("");
    },
  });

  return (
    <section aria-label="Route specialized work" className="tt-surface space-y-4 p-6">
      <SectionHeading
        eyebrow="Hand across"
        title="Route this to a specialist room"
        description="A route is a request. Ops and Studio own whether they accept it, and own the work once they do. Nothing downstream is created here."
      />
      <div className="flex flex-wrap gap-2">
        {ROUTE_TARGETS.map((option) => (
          <TTButton
            key={option}
            size="sm"
            variant={option === target ? "primary" : "secondary"}
            onClick={() => setTarget(option)}
          >
            {ROUTE_TARGET_LABEL[option]}
          </TTButton>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TTInput
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          placeholder={`What ${ROUTE_TARGET_LABEL[target]} is asked to deliver`}
          aria-label="Requested outcome"
        />
        <TTInput
          value={because}
          onChange={(event) => setBecause(event.target.value)}
          placeholder="Why it is leaving Projects"
          aria-label="Why this is routed"
        />
      </div>
      <TTButton
        size="sm"
        disabled={!allowed || route.isPending || !outcome.trim() || !because.trim()}
        onClick={() => route.mutate()}
      >
        Ask {ROUTE_TARGET_LABEL[target]} to take this
      </TTButton>
      {!allowed ? (
        <p className="text-sm text-muted-foreground">
          Your role can read Projects but not route work out of it.
        </p>
      ) : null}
      {route.isSuccess ? (
        <p className="text-sm text-muted-foreground">
          Asked. {ROUTE_TARGET_LABEL[target]} has not accepted it yet — acceptance is theirs to
          record.
        </p>
      ) : null}
      {route.error ? (
        <p role="alert" className="text-sm text-destructive">
          {route.error instanceof Error ? route.error.message : "That route could not be recorded."}
        </p>
      ) : null}
    </section>
  );
}
