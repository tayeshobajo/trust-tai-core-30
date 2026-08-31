/**
 * The Person card on a Scout company.
 *
 * Name, title, company — the three things Comms cannot open without. Saving
 * them is a human confirmation, so it also prepares the first message in Comms
 * with exactly those words. Nothing is sent.
 */

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { TTButton, TTInput } from "@/components/tt/primitives";
import type { ProspectPersonIdentity, SavedProspectPerson } from "@/data/scout/person-card";
import type { Person } from "@/domain/people";

import { DetailSection, Empty } from "./parts";

export function ProspectPersonCard({
  people,
  companyName,
  saving,
  saved,
  error,
  onSave,
}: {
  people: Person[];
  companyName: string;
  saving: boolean;
  /** The result of the last save, so the prepared draft can be offered. */
  saved: SavedProspectPerson | null;
  error: string | null;
  onSave: (person: Person, identity: ProspectPersonIdentity) => void;
}) {
  const [personId, setPersonId] = useState<string>(people[0]?.id ?? "");
  const person = people.find((row) => row.id === personId) ?? people[0] ?? null;

  const [fullName, setFullName] = useState("");
  const [roleTitle, setRoleTitle] = useState("");
  const [company, setCompany] = useState("");

  useEffect(() => {
    if (!person) return;
    setPersonId(person.id);
    setFullName(person.fullName);
    setRoleTitle(person.roleTitle ?? "");
    setCompany(companyName);
  }, [person, companyName]);

  if (!person) {
    return (
      <DetailSection title="Person" meta="none on record">
        <Empty>
          No one is on record for {companyName} yet. Add a person below and their card appears
          here.
        </Empty>
      </DetailSection>
    );
  }

  const prepared = saved?.prepared ?? null;

  return (
    <DetailSection title="Person" meta="name, title, company">
      {people.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {people.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setPersonId(row.id)}
              className={
                row.id === person.id
                  ? "rounded-full border border-royal px-3 py-1 text-[12px] text-royal"
                  : "rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground hover:text-foreground"
              }
            >
              {row.fullName}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3">
        <TTInput
          className="h-9"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Full name"
          aria-label="Full name"
        />
        <TTInput
          className="h-9"
          value={roleTitle}
          onChange={(event) => setRoleTitle(event.target.value)}
          placeholder="Title"
          aria-label="Title"
        />
        <TTInput
          className="h-9"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          placeholder="Company"
          aria-label="Company"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <TTButton
          disabled={saving || !fullName.trim()}
          onClick={() =>
            onSave(person, {
              fullName,
              roleTitle,
              companyName: company,
            })
          }
        >
          {saving ? "Saving and preparing…" : "Save person"}
        </TTButton>
        <p className="text-[13px] text-muted-foreground">
          Saving confirms this person and prepares the first message in Comms. Nothing is sent.
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {saved ? (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3">
          <p className="text-[13px] text-foreground">
            {prepared
              ? prepared.created
                ? "Saved. A first message is prepared in Comms with their name, title and company."
                : "Saved. A prepared first message already exists in Comms."
              : (saved.because ?? "Saved to their record.")}
          </p>
          {prepared ? (
            <TTButton asChild variant="secondary" size="sm" className="mt-2">
              <Link to="/modules/comms" search={{ relationship: prepared.relationshipId }}>
                Review the draft in Comms
              </Link>
            </TTButton>
          ) : null}
        </div>
      ) : null}
    </DetailSection>
  );
}
