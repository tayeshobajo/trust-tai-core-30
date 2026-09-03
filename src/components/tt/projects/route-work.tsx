/**
 * Ask Ops or Studio to take a bounded piece of this project's work.
 *
 * A route is a request. Nothing downstream is created here, and nothing is
 * claimed as accepted: Projects records that it asked, with the project's own
 * ids, evidence and boundary travelling with the ask.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { MetaPill, SectionHeading, TTButton, TTInput } from "@/components/tt/primitives";
import { routeStanding, type RouteLedgerEntry } from "@/domain/route-ledger";
import { projectsService, type ProjectsContext } from "@/data/supabase/projects-service";
import type { AccessContext } from "@/domain/access";
import { can } from "@/domain/access";
import { ROUTE_TARGETS, ROUTE_TARGET_LABEL, type RouteTarget } from "@/domain/project-routing";
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
  const queryClient = useQueryClient();

  const ledger = useQuery({
    queryKey: ["project-routes", project.organizationId, project.id],
    queryFn: async () =>
      (await projectsService.routeLedger(project.organizationId)).filter(
        (entry) => entry.projectId === project.id,
      ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["project-routes"] });
    void queryClient.invalidateQueries({ queryKey: ["pulse-routes"] });
  };

  const withdraw = useMutation({
    mutationFn: ({ entry, because }: { entry: RouteLedgerEntry; because: string }) =>
      projectsService.withdrawRoute(entry, because, context, access),
    onSuccess: invalidate,
  });

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
      invalidate();
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
          Asked. {ROUTE_TARGET_LABEL[target]} has not accepted it yet, acceptance is theirs to
          record.
        </p>
      ) : null}
      {(ledger.data ?? []).length > 0 ? (
        <div className="space-y-3 border-t border-border/60 pt-4">
          <p className="tt-eyebrow">Already asked</p>
          {(ledger.data ?? []).map((entry) => (
            <RouteRow
              key={entry.key}
              entry={entry}
              allowed={allowed}
              pending={withdraw.isPending}
              onWithdraw={(because) => withdraw.mutate({ entry, because })}
            />
          ))}
          {withdraw.error ? (
            <p role="alert" className="text-sm text-destructive">
              {withdraw.error instanceof Error
                ? withdraw.error.message
                : "That withdrawal could not be recorded."}
            </p>
          ) : null}
        </div>
      ) : null}
      {route.error ? (
        <p role="alert" className="text-sm text-destructive">
          {route.error instanceof Error ? route.error.message : "That route could not be recorded."}
        </p>
      ) : null}
    </section>
  );
}

/**
 * One ask, as it stands. Withdrawing is a person's decision and needs a
 * reason: the receiving room reads why, and can no longer record acceptance.
 */
function RouteRow({
  entry,
  allowed,
  pending,
  onWithdraw,
}: {
  entry: RouteLedgerEntry;
  allowed: boolean;
  pending: boolean;
  onWithdraw: (because: string) => void;
}) {
  const [because, setBecause] = useState("");
  const open = entry.status === "requested";

  return (
    <div className="space-y-2 rounded-md bg-muted/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <MetaPill>{ROUTE_TARGET_LABEL[entry.targetApp]}</MetaPill>
        <MetaPill>{entry.status}</MetaPill>
        {entry.unanswered ? <MetaPill>Unanswered</MetaPill> : null}
      </div>
      <p className="max-w-reading text-sm text-foreground">{entry.requestedOutcome}</p>
      <p className="max-w-reading text-sm text-muted-foreground">{routeStanding(entry)}</p>
      {entry.withdrawnBecause ? (
        <p className="max-w-reading text-sm text-muted-foreground">
          Withdrawn because: {entry.withdrawnBecause}
        </p>
      ) : null}
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <TTInput
            value={because}
            onChange={(event) => setBecause(event.target.value)}
            placeholder="Why the ask is being taken back"
            aria-label="Why this route is withdrawn"
            className="max-w-sm"
          />
          <TTButton
            size="sm"
            variant="quiet"
            disabled={!allowed || pending || because.trim().length === 0}
            onClick={() => onWithdraw(because.trim())}
          >
            Withdraw this ask
          </TTButton>
        </div>
      ) : null}
    </div>
  );
}
