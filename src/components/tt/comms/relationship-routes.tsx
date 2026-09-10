/**
 * The relationship's routes: where a message to this person can actually go.
 *
 * A relationship handed over from Scout can arrive with no email at all, and
 * until now nothing in Comms could add one, both send paths refused with
 * "Add one before sending" and the door stayed shut. This editor is that
 * door: a member adds or corrects the email on the relationship row, and a
 * LinkedIn profile URL kept in relationship metadata.
 *
 * Confirmation mirrors Scout's "Add a route" form: a separate, explicit
 * checkbox per field. An address saved without being confirmed stays on
 * record, plainly labelled unverified, and cannot be sent to until somebody
 * says it is right. This edits ROUTING on the relationship, not the person's
 * identity, the People card above handles who they are.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import type { Relationship } from "@/domain/comms";
import {
  readEmailConfirmed,
  readLinkedinRoute,
  routePatch,
  validateLinkedinUrl,
  validateRouteEmail,
  type RoutePatch,
} from "@/domain/comms-routes";

const FIELD_CLASS =
  "mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function RelationshipRoutes({
  relationship,
  busy,
  error,
  onSave,
}: {
  relationship: Relationship;
  busy?: boolean;
  error?: string | null;
  onSave: (patch: RoutePatch) => void;
}) {
  const linkedin = readLinkedinRoute(relationship.metadata);
  const emailConfirmed = readEmailConfirmed(relationship.metadata);

  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [emailChecked, setEmailChecked] = useState(false);
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [linkedinChecked, setLinkedinChecked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function open() {
    setEmail(relationship.email ?? "");
    setEmailChecked(emailConfirmed);
    setLinkedinUrl(linkedin?.url ?? "");
    setLinkedinChecked(linkedin?.confirmed ?? false);
    setProblem(null);
    setEditing(true);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const badEmail = validateRouteEmail(email);
    const badLinkedin = validateLinkedinUrl(linkedinUrl);
    if (badEmail || badLinkedin) {
      setProblem(badEmail ?? badLinkedin);
      return;
    }
    if (!email.trim() && !linkedinUrl.trim()) {
      setProblem("Enter an email address or a LinkedIn profile URL first.");
      return;
    }
    setProblem(null);
    onSave(
      routePatch(relationship.metadata, {
        ...(email.trim() ? { email, emailConfirmed: emailChecked } : {}),
        ...(linkedinUrl.trim() ? { linkedinUrl, linkedinConfirmed: linkedinChecked } : {}),
      }),
    );
    setEditing(false);
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-card px-3.5 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tt-eyebrow">Routes</p>
        {!editing ? (
          <TTButton variant="quiet" size="sm" type="button" onClick={open}>
            {relationship.email || linkedin ? "Edit routes" : "Add a route"}
          </TTButton>
        ) : null}
      </div>

      {!editing ? (
        <ul className="mt-2 space-y-1 text-[13px]">
          <li className="text-muted-foreground">
            {relationship.email ? (
              <>
                <span className="text-foreground">{relationship.email}</span>
                {" · "}
                {emailConfirmed
                  ? "confirmed email"
                  : "unverified, cannot be sent to until somebody confirms it"}
              </>
            ) : (
              "No email on record."
            )}
          </li>
          <li className="text-muted-foreground">
            {linkedin ? (
              <>
                <a
                  href={linkedin.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                >
                  LinkedIn profile
                </a>
                {" · "}
                {linkedin.confirmed
                  ? "confirmed LinkedIn route"
                  : "unverified, kept as a link, not a route"}
              </>
            ) : (
              "No LinkedIn profile on record."
            )}
          </li>
        </ul>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <p className="text-[13px] text-muted-foreground">
            An address saved without being confirmed stays on record, and cannot be sent to until
            somebody says it is right. Tick a box below only when you have actually checked.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[13px]">
              <span className="tt-eyebrow">Email address</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>
            <label className="block text-[13px]">
              <span className="tt-eyebrow">LinkedIn profile URL</span>
              <input
                type="url"
                value={linkedinUrl}
                onChange={(event) => setLinkedinUrl(event.target.value)}
                className={FIELD_CLASS}
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-background p-2.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={emailChecked}
              onChange={(event) => setEmailChecked(event.target.checked)}
            />
            <span>
              <span className="block text-[13px] text-foreground">
                I&rsquo;ve checked this address is right
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                Leave this clear and the address is kept, marked unverified, and nothing is sent to
                it.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-background p-2.5">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={linkedinChecked}
              onChange={(event) => setLinkedinChecked(event.target.checked)}
            />
            <span>
              <span className="block text-[13px] text-foreground">
                I&rsquo;ve checked this is the right person
              </span>
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                Leave this clear and the link is kept as a link, not as a route anyone can be
                approached through.
              </span>
            </span>
          </label>

          <div className="flex items-center gap-2">
            <TTButton type="submit" size="sm" disabled={busy}>
              {busy ? "Saving…" : "Save routes"}
            </TTButton>
            <TTButton variant="quiet" size="sm" type="button" onClick={() => setEditing(false)}>
              Cancel
            </TTButton>
          </div>
          {problem ? <p className="text-[13px] text-destructive">{problem}</p> : null}
          {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
        </form>
      )}
    </div>
  );
}
