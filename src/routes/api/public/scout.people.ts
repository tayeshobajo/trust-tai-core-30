/**
 * Scout, people research for one qualified account (server route).
 *
 * What happens here and nothing else:
 *   GET               tell the browser whether contact enrichment is connected
 *                     in THIS app runtime. Never a key, never part of one.
 *   POST discover     search the configured provider for people who could own
 *                     or influence the problem. Search only. No paid lookup.
 *   POST list         read the people already saved for this company.
 *   POST save         save selected research durably. No provider call.
 *   POST enrich       one paid work-email lookup for one named person, asked
 *                     for by a person who clicked, written durably here.
 *   POST handoff      record which Comms relationship this person moved into.
 *
 * The path is public so it can be reached without the site session, so the
 * handler proves the caller itself: a valid Trust Tai token, an active
 * membership in the workspace it claims, and, for anything that writes, a role
 * allowed to write. Membership alone never grants a write.
 *
 * Two boundaries are absolute. The browser never states an address or a
 * verification: those are derived from the provider's own answer inside the
 * store. And every reference a request supplies is checked against the
 * workspace the caller proved, never trusted because it was sent.
 */

import { createFileRoute } from "@tanstack/react-router";

import { bearerToken, clientForToken, requireActiveMember } from "@/lib/context-packet.server";
import {
  EnrichmentNotConfigured,
  ProviderFailure,
  enrichWorkEmail,
  enrichmentStatus,
  searchPeople,
} from "@/lib/contact-enrichment.server";
import {
  ScoutPeopleSchemaUnavailable,
  ScoutPeopleStoreError,
  scoutPeopleStore,
  type StoredScoutPerson,
} from "@/lib/scout-people-store.server";
import { savableResearch } from "@/domain/scout-people-persistence";
import {
  consumeReceipt,
  issueReceipt,
  readReceipt,
  RECEIPT_TTL_MINUTES,
} from "@/lib/scout-enrichment-receipts.server";
import { NOT_CONNECTED_MESSAGE, RECOMMENDED_LIMIT, type ScoutPerson } from "@/domain/scout-people";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const WRITE_ACTIONS = new Set(["save", "enrich", "handoff", "save-email"]);
const KNOWN_ACTIONS = new Set(["discover", "list", "save", "enrich", "handoff", "save-email"]);

function storeFailure(error: unknown): Response | null {
  if (error instanceof ScoutPeopleSchemaUnavailable) {
    return Response.json({ error: error.message, schemaUnavailable: true }, { status: 503 });
  }
  if (error instanceof ScoutPeopleStoreError) {
    return Response.json({ error: error.message, saved: false }, { status: 502 });
  }
  return null;
}

function forClient(person: StoredScoutPerson) {
  return person;
}

export const Route = createFileRoute("/api/public/scout/people")({
  server: {
    handlers: {
      GET: async () => Response.json(enrichmentStatus()),

      POST: async ({ request }) => {
        const token = bearerToken(request);
        if (!token) {
          return Response.json({ error: "Sign in to research people." }, { status: 401 });
        }

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ error: "That request could not be read." }, { status: 400 });
        }

        const organizationId = str(body["organizationId"]);
        const action = str(body["action"]);
        const prospectId = str(body["prospectId"]);

        if (!organizationId || !KNOWN_ACTIONS.has(action)) {
          return Response.json(
            { error: "A workspace and a known action are both needed." },
            { status: 400 },
          );
        }

        const caller = await requireActiveMember(clientForToken(token), token, organizationId);
        if (!caller) {
          return Response.json(
            { error: "You are not an active member of this workspace." },
            { status: 403 },
          );
        }
        if (WRITE_ACTIONS.has(action) && !caller.canWrite) {
          return Response.json(
            { error: "Your role in this workspace can view research but not change it." },
            { status: 403 },
          );
        }

        /* ------------------- storing an answer we already paid for once ---
           No provider is called here. The address and its verification come
           from the receipt the server issued when it heard the answer, so a
           retry costs nothing and a browser cannot state "verified". */

        if (action === "save-email") {
          const receiptId = str(body["receiptId"]);
          if (!prospectId || !receiptId) {
            return Response.json(
              { error: "A company and a lookup receipt are both needed." },
              { status: 400 },
            );
          }
          const receipt = readReceipt({ id: receiptId, organizationId, prospectId });
          if (!receipt) {
            return Response.json(
              {
                error: `That lookup result is no longer held by the server. Receipts last ${RECEIPT_TTL_MINUTES} minutes and do not survive a restart, so it cannot be saved without looking the person up again.`,
                receiptExpired: true,
              },
              { status: 410 },
            );
          }
          try {
            const store = scoutPeopleStore();
            const incoming = body["person"] as Partial<ScoutPerson> | undefined;
            const savable = incoming ? savableResearch(incoming) : null;
            if (!savable) {
              return Response.json({ error: "There was nobody to save." }, { status: 400 });
            }
            const [saved] = await store.saveResearch({
              organizationId,
              prospectId,
              createdBy: caller.userId,
              people: [savable],
            });
            if (!saved) {
              return Response.json(
                { error: "That person could not be saved, so the address was not stored." },
                { status: 502 },
              );
            }
            const person = await store.recordEmail({
              organizationId,
              prospectId,
              personId: saved.id,
              answer: receipt.answer,
            });
            consumeReceipt(receiptId);
            return Response.json({ person: forClient(person), persisted: true });
          } catch (error) {
            const response = storeFailure(error);
            if (response) return response;
            return Response.json(
              { error: "That address could not be saved. Nothing was changed." },
              { status: 500 },
            );
          }
        }

        /* ------------------------------------------------ durable reads */

        if (action === "list" || action === "save" || action === "handoff") {
          if (!prospectId && action !== "handoff") {
            return Response.json({ error: "A company is needed." }, { status: 400 });
          }
          try {
            const store = scoutPeopleStore();

            if (action === "list") {
              const people = await store.list({ organizationId, prospectId });
              return Response.json({ people: people.map(forClient), persisted: true });
            }

            if (action === "save") {
              const incoming = Array.isArray(body["people"])
                ? (body["people"] as Partial<ScoutPerson>[])
                : [];
              const savable = incoming
                .map((person) => savableResearch(person))
                .filter((person): person is NonNullable<typeof person> => person !== null);
              if (savable.length === 0) {
                return Response.json({ error: "There was nobody to save." }, { status: 400 });
              }
              const saved = await store.saveResearch({
                organizationId,
                prospectId,
                createdBy: caller.userId,
                people: savable,
              });
              return Response.json({ people: saved.map(forClient), persisted: true });
            }

            const personId = str(body["personId"]);
            const relationshipId = str(body["relationshipId"]);
            if (!personId || !relationshipId) {
              return Response.json(
                { error: "A saved person and a conversation are both needed." },
                { status: 400 },
              );
            }
            const person = await store.recordHandoff({
              organizationId,
              personId,
              relationshipId,
              ...(str(body["contactId"]) ? { contactId: str(body["contactId"]) } : {}),
            });
            return Response.json({ person: forClient(person), persisted: true });
          } catch (error) {
            const response = storeFailure(error);
            if (response) return response;
            return Response.json(
              { error: "That could not be saved. Nothing was changed." },
              { status: 500 },
            );
          }
        }

        /* --------------------------------------------- provider actions */

        const companyName = str(body["companyName"]);
        if (!companyName) {
          return Response.json({ error: "A company is needed." }, { status: 400 });
        }
        const domain = str(body["domain"]) || undefined;

        const status = enrichmentStatus();
        if (!status.connected) {
          return Response.json({ error: NOT_CONNECTED_MESSAGE, connected: false }, { status: 501 });
        }

        try {
          if (action === "discover") {
            const limit = typeof body["limit"] === "number" ? body["limit"] : RECOMMENDED_LIMIT * 3;
            const result = await searchPeople({
              companyName,
              ...(domain ? { domain } : {}),
              roleFamilies: strings(body["roleFamilies"]),
              limit,
            });
            return Response.json({
              provider: result.provider,
              people: result.people,
              // Search does not buy an address. Enrichment is a separate click.
              enriched: false,
            });
          }

          const fullName = str(body["fullName"]);
          if (!fullName) {
            return Response.json({ error: "A person's name is needed." }, { status: 400 });
          }
          const result = await enrichWorkEmail({
            fullName,
            companyName,
            ...(domain ? { domain } : {}),
            ...(str(body["providerPersonId"])
              ? { providerPersonId: str(body["providerPersonId"]) }
              : {}),
            ...(str(body["profileUrl"]) ? { profileUrl: str(body["profileUrl"]) } : {}),
          });

          const answer = {
            email: result.email ?? null,
            verified: result.verified === true,
            provider: result.provider,
            at: result.at,
          };

          /* The answer itself, stated once and never mixed with persistence.
             `providerNote` is the provider explaining its own result, so it is
             never shown as a saving failure. */
          const found = {
            provider: result.provider,
            email: result.email ?? null,
            verified: answer.verified,
            at: result.at,
            ...(result.because ? { providerNote: result.because } : {}),
          };

          // A saved person gets the answer written to their row, derived from
          // what the provider said and nothing the browser sent.
          const personId = str(body["personId"]);
          if (personId && prospectId) {
            try {
              const person = await scoutPeopleStore().recordEmail({
                organizationId,
                prospectId,
                personId,
                answer,
              });
              return Response.json({ ...found, person: forClient(person), persisted: true });
            } catch (error) {
              const receipt = prospectId
                ? issueReceipt({
                    organizationId,
                    prospectId,
                    identity: str(body["identity"]),
                    answer,
                  })
                : null;
              return Response.json({
                ...found,
                persisted: false,
                schemaUnavailable: error instanceof ScoutPeopleSchemaUnavailable,
                saveError:
                  error instanceof Error
                    ? error.message
                    : "The lookup finished but could not be saved.",
                ...(receipt
                  ? { receiptId: receipt.id, receiptExpiresAt: receipt.expiresAt }
                  : {}),
              });
            }
          }

          /* Nobody to write to yet. The answer is still real, so it is handed
             back with a receipt that can store it later for nothing. */
          const receipt = prospectId
            ? issueReceipt({
                organizationId,
                prospectId,
                identity: str(body["identity"]),
                answer,
              })
            : null;
          return Response.json({
            ...found,
            persisted: false,
            saveError: prospectId
              ? "This person is not on record yet, so the address is only on this page."
              : "There is no company record to save this address to.",
            ...(receipt ? { receiptId: receipt.id, receiptExpiresAt: receipt.expiresAt } : {}),
          });
        } catch (error) {
          if (error instanceof EnrichmentNotConfigured) {
            return Response.json({ error: error.message, connected: false }, { status: 501 });
          }
          if (error instanceof ProviderFailure) {
            return Response.json(
              {
                error: `${error.provider} could not answer. Nothing was saved.`,
                retryable: error.retryable,
              },
              { status: 502 },
            );
          }
          return Response.json(
            { error: "That lookup stopped unexpectedly. Nothing was saved." },
            { status: 500 },
          );
        }
      },
    },
  },
});
