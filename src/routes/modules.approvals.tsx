/**
 * Approvals, the room where decisions get made.
 *
 * Not a business room: it owns no entity and writes no room's truth. It owns
 * the decision and the provenance of the decision. Every other room prepares
 * work, submits it here, and executes only after a person has said yes.
 *
 * Three laws hold the surface together:
 *
 *   - Approving records authority. It does not perform the work.
 *   - The owning room's own write permission is still required to decide.
 *   - Anything the system cannot honestly do is said plainly, not hidden.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { ApprovalBoard, type BoardColumnView } from "@/components/tt/approvals/approval-board";
import {
  ApprovalWorkspace,
  type DecisionInput,
} from "@/components/tt/approvals/approval-workspace";
import { EmptyState, MetaPill, PageHeader, TTButton } from "@/components/tt/primitives";
import {
  APPROVALS_MIGRATION,
  approvalsSchemaReady,
  approvalsService,
} from "@/data/supabase/approvals-service";
import { executeApprovedRequest } from "@/data/approvals/execution";
import { backfillCommsApprovals } from "@/data/approvals/intake";
import { backfillScoutApprovals } from "@/data/approvals/scout-intake";
import { accessContext, can } from "@/domain/access";
import {
  BOARD_COLUMNS,
  CATEGORY_TAB_LABEL,
  approvalRefusal,
  dropOutcome,
  type ApprovalRequest,
  type ApprovalSort,
  type BoardColumn,
  type CategoryTab,
} from "@/domain/approvals";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Approvals · Trust Tai OS";
const DESCRIPTION =
  "One place to decide. Agents prepare the work, you approve it, and the room that owns the work executes afterwards.";

const TABS: CategoryTab[] = ["all", "marketing", "comms", "scout", "roadmap", "delivery"];
/** Cards fetched per column before the person asks for more. */
const PAGE = 25;

const SORTS: Array<{ id: ApprovalSort; label: string }> = [
  { id: "priority", label: "Most pressing" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Longest waiting" },
];

export const Route = createFileRoute("/modules/approvals")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: ApprovalsRoute,
});

function ApprovalsRoute() {
  return (
    <WorkspaceGate
      appId="approvals"
      preview={{
        room: "Approvals",
        purpose:
          "The one place every prepared action waits for a human decision, with the reasoning and the boundary shown before you say yes.",
        unavailable: [
          "The approval queue",
          "Approving, rejecting or returning work",
          "The decision trail",
        ],
        returnTo: "/modules/approvals",
      }}
    >
      {(identity) => (
        <AppShell identity={identity}>
          <ApprovalsRoom identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

function ApprovalsRoom({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<CategoryTab>("all");
  const [sort, setSort] = useState<ApprovalSort>("priority");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [pageSize, setPageSize] = useState<Record<BoardColumn, number>>({
    needs_review: PAGE,
    needs_context: PAGE,
    ready: PAGE,
    approved: PAGE,
  });

  const context = {
    organizationId: identity.organizationId,
    userId: identity.userId,
  };

  const access = accessContext({
    userId: identity.userId,
    organizationId: identity.organizationId,
    role: identity.role,
  });

  /* Searching is a database question, asked once the typing settles, so the
     board stays responsive with hundreds of rows behind it. */
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const schema = useQuery({
    queryKey: ["approvals-schema", identity.organizationId],
    queryFn: () => approvalsSchemaReady(identity.organizationId),
  });

  const totals = useQuery({
    queryKey: ["approvals", "tab-totals", identity.organizationId, search],
    queryFn: () => approvalsService.tabTotals(context, search ? { search } : {}),
  });

  const columnTotals = useQuery({
    queryKey: ["approvals", "column-totals", identity.organizationId, tab, search],
    queryFn: () => approvalsService.columnTotals(context, { tab, ...(search ? { search } : {}) }),
  });

  /* One bounded page per column. Nothing off screen is ever fetched. */
  const pages = useQueries({
    queries: BOARD_COLUMNS.map((column) => ({
      queryKey: [
        "approvals",
        "page",
        identity.organizationId,
        tab,
        search,
        sort,
        column,
        pageSize[column],
      ],
      queryFn: () =>
        approvalsService.listPage(context, {
          tab,
          column,
          sort,
          limit: pageSize[column],
          ...(search ? { search } : {}),
        }),
      placeholderData: (previous: unknown) => previous,
    })),
  });

  const columns = useMemo(() => {
    const view = {} as Record<BoardColumn, BoardColumnView>;
    BOARD_COLUMNS.forEach((column, index) => {
      const page = pages[index];
      view[column] = {
        rows: page?.data?.rows ?? [],
        total: columnTotals.data?.[column] ?? page?.data?.total ?? 0,
        hasMore: page?.data?.hasMore ?? false,
        loading: page?.isFetching ?? false,
      };
    });
    return view;
  }, [pages, columnTotals.data]);

  const counts = totals.data ?? {
    all: 0,
    marketing: 0,
    comms: 0,
    scout: 0,
    roadmap: 0,
    delivery: 0,
  };

  const loading = pages.some((page) => page.isLoading);
  const empty = !loading && BOARD_COLUMNS.every((column) => columns[column].total === 0);
  const now = new Date().toISOString();

  /* The selected card survives paging: its detail is read by id, not from the
     rows currently on screen. */
  const detail = useQuery({
    queryKey: ["approval", identity.organizationId, openId],
    queryFn: () => (openId ? approvalsService.get(context, openId) : null),
    enabled: Boolean(openId),
  });

  function refusalFor(request: ApprovalRequest): string | null {
    return approvalRefusal({
      can: (permission) => can(access, permission),
      active: true,
      requiredCapability: request.requiredCapability,
      requestOrganizationId: request.organizationId,
      organizationId: identity.organizationId,
    });
  }

  const decide = useMutation({
    mutationFn: async ({ request, input }: { request: ApprovalRequest; input: DecisionInput }) => {
      const decidedBy = { id: identity.userId, label: identity.name || "You" };
      const at = new Date().toISOString();

      if (input.action.id === "reject") {
        return {
          request: await approvalsService.decide(context, {
            requestId: request.id,
            to: "rejected",
            decision: { decision: "reject", decidedBy, decidedAt: at, reason: input.reason },
          }),
        };
      }

      if (input.action.id === "request_revision") {
        return {
          request: await approvalsService.decide(context, {
            requestId: request.id,
            to: "revision_requested",
            decision: {
              decision: "request_revision",
              decidedBy,
              decidedAt: at,
              reason: input.reason,
            },
          }),
        };
      }

      /* Approval records authority and nothing else. The handover to the
         owning room is a second, separate act with its own recorded state. */
      const approved = await approvalsService.decide(context, {
        requestId: request.id,
        to: "approved",
        decision: {
          decision: "approve",
          decidedBy,
          decidedAt: at,
          ...(input.reason ? { reason: input.reason } : {}),
          ...(request.batch ? { itemIds: input.itemIds } : {}),
        },
        ...(request.batch ? { itemIds: input.itemIds } : {}),
      });

      /* The owning room performs the work through its own governed path. */
      const outcome = await executeApprovedRequest(approved, context);
      await approvalsService.recordDownstream(
        context,
        request.id,
        outcome.result,
        outcome.nextStatus,
      );
      return { request: approved, outcome };
    },
    onSuccess: (result) => {
      const outcome = "outcome" in result ? result.outcome : null;
      if (outcome && outcome.result.state !== "queued") {
        toast.warning(outcome.result.because);
      } else {
        toast.success(outcome ? outcome.result.because : "Recorded.");
      }
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
      void queryClient.invalidateQueries({ queryKey: ["approval"] });
    },
    onSettled: () => setMovingId(null),
    onError: (error: Error) => toast.error(error.message),
  });

  /* Dragging resolves to the card's own authorising action. The card shows the
     move at once and returns to its column, with the reason, if it is refused. */
  const onDropInto = useCallback(
    (request: ApprovalRequest, column: BoardColumn) => {
      const outcome = dropOutcome(request, column);
      if (!outcome.ok) {
        toast.warning(outcome.because);
        return;
      }
      const refusal = refusalFor(request);
      if (refusal) {
        toast.error(refusal);
        return;
      }
      /* A batch is a set of individual judgments. Dragging it whole would
         approve items nobody looked at, so it opens instead. */
      if (request.batch) {
        setOpenId(request.id);
        toast.info("Choose which items to approve inside the card.");
        return;
      }
      if (
        outcome.confirm &&
        !window.confirm(
          `${request.title}\n\n${request.boundary.willDo.join("\n")}\n\nApprove this now?`,
        )
      ) {
        return;
      }
      setMovingId(request.id);
      decide.mutate({
        request,
        input: { action: outcome.action, reason: "", itemIds: [] },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [decide, access, identity.organizationId],
  );

  const addNote = useMutation({
    mutationFn: (input: { requestId: string; body: string }) =>
      approvalsService.addNote(context, input.requestId, input.body, {
        id: identity.userId,
        label: identity.name || "You",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["approval"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /* A safe catch-up for work parked before intake existed. It reads real rows
     only and reuses the same source key, so running it twice changes nothing. */
  const backfill = useMutation({
    mutationFn: () => backfillCommsApprovals(context),
    onSuccess: (report) => {
      if (report.scanned === 0) {
        toast.success("No Comms drafts are waiting on a person.");
      } else {
        toast.success(
          `${report.submitted} of ${report.scanned} Comms drafts are in the queue.` +
            (report.failed > 0 ? ` ${report.failed} could not be read.` : ""),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /* The same source-owned adapter the live path uses, run over rows that
     predate it. Idempotent by source key, so a second run changes nothing. */
  const scoutBackfill = useMutation({
    mutationFn: () => backfillScoutApprovals(context),
    onSuccess: (report) => {
      if (report.scanned === 0) {
        toast.success("No Scout matches are waiting on a decision.");
      } else {
        toast.success(
          `${report.submitted} of ${report.scanned} strong Scout matches are in the queue` +
            ` (${report.ready} ready, ${report.needsContext} need context).`,
        );
      }
      void queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const open = detail.data;

  return (
    <div className="space-y-8">
      <PageHeader
        appId="approvals"
        eyebrow="Trust Tai OS · Approvals"
        title="What needs your decision"
        supporting="Agents prepare the work. You decide. The room that owns the work executes afterwards, and never before."
        action={<MetaPill>{counts.all} waiting</MetaPill>}
      />

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            aria-pressed={tab === entry}
            className={`rounded-full px-4 py-2 text-sm transition-colors ${
              tab === entry
                ? "bg-royal text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {CATEGORY_TAB_LABEL[entry]}
            {counts[entry] > 0 ? (
              <span className="ml-2 font-mono text-[10px]">{counts[entry]}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by person, company, project or title"
          className="tt-level-secondary min-w-[16rem] flex-1 rounded-full px-4 py-2 text-sm outline-none"
        />
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as ApprovalSort)}
          className="tt-level-secondary rounded-full px-4 py-2 text-sm outline-none"
          aria-label="Sort approvals"
        >
          {SORTS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label}
            </option>
          ))}
        </select>
        <TTButton variant="quiet" size="sm" onClick={() => setShowDiagnostics((value) => !value)}>
          {showDiagnostics ? "Hide more" : "More"}
        </TTButton>
      </div>

      {showDiagnostics ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-4">
          <p className="tt-eyebrow mr-auto">Recovery checks</p>
          <TTButton
            variant="quiet"
            size="sm"
            onClick={() => backfill.mutate()}
            disabled={backfill.isPending}
          >
            {backfill.isPending ? "Checking Comms…" : "Check Comms for waiting drafts"}
          </TTButton>
          <TTButton
            variant="quiet"
            size="sm"
            onClick={() => scoutBackfill.mutate()}
            disabled={scoutBackfill.isPending}
          >
            {scoutBackfill.isPending ? "Checking Scout…" : "Check Scout for strong matches"}
          </TTButton>
        </div>
      ) : null}

      {schema.data === false ? (
        <div className="rounded-xl border border-dashed border-border p-5">
          <p className="tt-eyebrow mb-2">Not connected yet</p>
          <p className="max-w-reading text-sm text-muted-foreground">
            {APPROVALS_MIGRATION} Until then this room shows an honest empty queue rather than
            pretending nothing needs deciding.
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Reading the queue…</p>
      ) : empty ? (
        <EmptyState
          title="Nothing is waiting on you"
          belongsHere="Prepared work from Comms, Scout, Marketing, Roadmap and Delivery lands here for a decision."
          whyItMatters="An empty queue means every agent-prepared action has already been judged by a person."
        />
      ) : (
        <ApprovalBoard
          columns={columns}
          now={now}
          activeId={openId}
          movingId={movingId}
          onOpen={(request) => setOpenId(request.id)}
          onDropInto={onDropInto}
          onLoadMore={(column) =>
            setPageSize((current) => ({ ...current, [column]: current[column] + PAGE }))
          }
        />
      )}

      {openId ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-foreground/20 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Approval detail"
        >
          <button
            type="button"
            aria-label="Close"
            className="flex-1 cursor-default"
            onClick={() => setOpenId(null)}
          />
          <div className="tt-level-primary flex h-full w-full max-w-2xl flex-col border-l border-border bg-background">
            {open ? (
              <ApprovalWorkspace
                request={open.request}
                items={open.items}
                events={open.events}
                refusal={refusalFor(open.request)}
                pending={decide.isPending}
                onDecide={(input) => decide.mutate({ request: open.request, input })}
                onNote={(body) => addNote.mutate({ requestId: open.request.id, body })}
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">Opening…</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
