import { useEffect, useRef, useState } from "react";
import {
  BriefcaseBusiness,
  Copy,
  Download,
  ExternalLink,
  FileText,
  LockKeyhole,
  Pencil,
  Search,
  UserRound,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  HIRING_PEOPLE,
  stageLabel,
  type Application,
  type Job,
  type Snapshot,
} from "@/domain/hiring";
import type { HiringService } from "@/data/supabase/hiring";
import { ownerName } from "./presentation";

export function RolesView({
  data,
  edit,
  duplicate,
  applications,
}: {
  data: Snapshot;
  edit: (job: Job) => void;
  duplicate: (job: Job) => void;
  applications: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const rows = data.jobs.filter(
    (j) =>
      (!status || j.status === status) &&
      [j.title, j.team, j.location, ownerName(j.owner_id, HIRING_PEOPLE)]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <div className="h-role-toolbar">
        <label className="h-search">
          Search roles
          <span>
            <Search size={18} aria-hidden="true" />
            <input
              placeholder="Search roles…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </span>
        </label>
        <div className="h-role-status" role="group" aria-label="Role status">
          {["", "open", "draft", "closed"].map((s) => (
            <Button
              key={s}
              variant="outline"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
            >
              {s ? stageLabel(s) : "All"} ({data.jobs.filter((j) => !s || j.status === s).length})
            </Button>
          ))}
        </div>
      </div>
      <div className="h-card h-table-card">
        <div className="h-table-scroll" tabIndex={0} role="region" aria-label="Roles table">
          <table className="h-roles-table">
            <caption className="sr-only">Hiring roles</caption>
            <thead>
              <tr>
                <th>Role / team</th>
                <th>Location</th>
                <th>Owner</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => (
                <tr key={j.id}>
                  <td>
                    <strong>{j.title}</strong>
                    <small>{j.team || "No team recorded"}</small>
                  </td>
                  <td>
                    {j.location || "Not recorded"}
                    <small>{j.arrangement}</small>
                  </td>
                  <td>
                    <span className="h-role-owner">
                      <UserRound size={18} aria-hidden="true" />
                      {ownerName(j.owner_id, HIRING_PEOPLE)}
                    </span>
                  </td>
                  <td>
                    <span className={`h-stage h-role-${j.status}`}>{stageLabel(j.status)}</span>
                  </td>
                  <td>
                    <div className="h-role-actions">
                      <Button
                        className={j.status === "draft" ? "" : "h-primary"}
                        variant="outline"
                        onClick={() => (j.status === "draft" ? edit(j) : applications(j.id))}
                      >
                        {j.status === "draft" ? "Continue draft" : "View applications"}
                      </Button>
                      {j.status === "draft" && (
                        <Button variant="outline" onClick={() => applications(j.id)}>
                          View applications
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        aria-label={`Edit ${j.title}`}
                        title={`Edit ${j.title}`}
                        onClick={() => edit(j)}
                      >
                        <Pencil size={18} />
                      </Button>
                      <Button
                        variant="outline"
                        aria-label={`Duplicate ${j.title} as draft`}
                        title="Duplicate as draft"
                        onClick={() => duplicate(j)}
                      >
                        <Copy size={18} />
                      </Button>
                    </div>
                    <small>
                      {data.applications.filter((a) => a.job_id === j.id).length} applications
                    </small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="h-empty">
            {data.jobs.length
              ? "No matching roles. Clear the search or choose All."
              : "No roles yet. Create a draft to begin."}
          </p>
        )}
        <p className="h-table-footnote">
          Draft roles are not visible on the careers site. Closed roles do not accept applications.
        </p>
      </div>
      <div className="h-role-guidance">
        <article className="h-card h-guidance">
          <span className="h-icon">
            <BriefcaseBusiness size={22} />
          </span>
          <div>
            <h2>Public careers page</h2>
            <p>See how your open roles appear to candidates.</p>
            <a href="https://trusttai.com/careers" target="_blank" rel="noreferrer">
              Preview careers <ExternalLink size={16} />
            </a>
          </div>
        </article>
        <article className="h-card h-guidance">
          <span className="h-icon">
            <FileText size={22} />
          </span>
          <div>
            <h2>Publish with confidence</h2>
            <p>
              Review the role and application questions before saving Open. Draft and Closed keep
              intake off; existing applications remain.
            </p>
          </div>
        </article>
      </div>
    </>
  );
}

export function CandidateContext({ app, view }: { app: Application; view: () => void }) {
  return (
    <>
      <article className="h-card">
        <h3>
          <UserRound size={20} />
          Candidate details
        </h3>
        <dl className="h-context-list">
          <div>
            <dt>Applied role</dt>
            <dd>{app.job_title}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{ownerName(app.owner_id, HIRING_PEOPLE)}</dd>
          </div>
          <div>
            <dt>Review date</dt>
            <dd>{app.review_date || "Not set"}</dd>
          </div>
        </dl>
        <Button variant="ghost" onClick={view}>
          <ExternalLink size={16} />
          View application
        </Button>
      </article>
      <article className="h-card">
        <h3>
          <Zap size={20} />
          Before sending
        </h3>
        <p>
          Check the recipient, saved message and next step. Applicant sending is not enabled. QA
          controls do not approve applicant delivery.
        </p>
      </article>
    </>
  );
}

export function PrivateResume({ app, service }: { app: Application; service: HiringService }) {
  const [link, setLink] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "expired" | "error">("idle");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setLink(null);
    setError("");
    setState("loading");
    clearTimeout(timer.current);
    try {
      const url = await service.resume(app.resume_path);
      if (!alive.current) return;
      if (!/^https:\/\//.test(url)) throw new Error("Private download is unavailable.");
      setLink(url);
      setState("ready");
      timer.current = setTimeout(() => {
        setLink(null);
        setState("expired");
      }, 60000);
    } catch (e) {
      if (alive.current) {
        setState("error");
        setError(
          e instanceof Error ? e.message : "Resume access was denied or the file is unavailable.",
        );
      }
    } finally {
      lock.current = false;
    }
  }
  return (
    <div className="h-private-resume">
      {app.resume_path ? (
        <>
          <div className="h-document-row">
            <span className="h-icon">
              <FileText size={22} />
            </span>
            <div>
              <strong>{app.resume_name || "Application résumé"}</strong>
              <small>Private application résumé</small>
            </div>
            <Button
              variant="outline"
              disabled={state === "loading"}
              onClick={() => void download()}
            >
              <Download size={18} />
              {state === "loading"
                ? "Preparing link…"
                : state === "error" || state === "expired"
                  ? "Retry résumé download"
                  : "Download résumé"}
            </Button>
          </div>
          {state === "loading" && <p role="status">Checking private file access…</p>}
          {state === "error" && <p role="alert">{error} Retry to check access again.</p>}
          {state === "expired" && (
            <p role="status">The temporary link expired. Request a new link to download.</p>
          )}
          {link && (
            <p>
              <a href={link} target="_blank" rel="noreferrer">
                Open private résumé (60 seconds)
              </a>
            </p>
          )}
        </>
      ) : (
        <p>No private résumé recorded.</p>
      )}
    </div>
  );
}

export function DocumentPrivacy() {
  return (
    <article className="h-card">
      <h3>
        <LockKeyhole size={20} />
        Private by default
      </h3>
      <p>Résumé access is checked against your current Hiring permissions.</p>
      <p>Downloads use a temporary link that expires after 60 seconds.</p>
      <hr className="h-context-rule" />
      <h4>File handling</h4>
      <p>
        Keep candidate documents inside the hiring workspace. An external portfolio is a link, not a
        stored attachment.
      </p>
    </article>
  );
}
