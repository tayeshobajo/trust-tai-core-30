/**
 * Who a message would go out as — decided once, for review and for dispatch.
 *
 * The sending identity is part of what is approved. If a review is approved
 * against one mailbox and the message then leaves from another, the approval
 * did not cover what happened. So the identity is resolved here, recorded on
 * the review, and compared again at dispatch through the payload fingerprint.
 *
 * Nothing here is inferred on somebody's behalf: where the workspace has more
 * than one mailbox that could send, this refuses and asks which one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DeliveryChannel } from "@/domain/comms-delivery";
import { GMAIL_SEND_SCOPE, resolveSendMailbox } from "@/domain/comms-integrations";
import { loadGmailConnections } from "@/lib/comms-gmail.server";

export class SenderIdentityUnavailable extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SenderIdentityUnavailable";
  }
}

export async function resolveSenderIdentity(
  client: SupabaseClient,
  input: { organizationId: string; channel: DeliveryChannel; integrationId?: string },
): Promise<string> {
  if (input.channel === "email_resend") {
    const from = process.env["RESEND_FROM_EMAIL"];
    if (!from) {
      throw new SenderIdentityUnavailable(
        "server_not_configured",
        "Email sending is not configured on the server, so there is no address to review against.",
      );
    }
    return from.toLowerCase();
  }

  if (input.channel === "linkedin_manual") {
    /* A LinkedIn message is sent by a person, by hand. The identity is that
       person, and it is recorded as such rather than guessed at. */
    const { data } = await client.auth.getUser();
    const userId = data.user?.id;
    if (!userId) {
      throw new SenderIdentityUnavailable(
        "access_denied",
        "You are not signed in, so there is no sender to review against.",
      );
    }
    return `user:${userId}`;
  }

  const connections = await loadGmailConnections(client, input.organizationId);
  const resolution = resolveSendMailbox({
    connections: connections.map((row) => {
      /* The same reading of a connection row as the send path uses; kept
         local so the review side does not import the dispatch module. */
      const connected = row.status === "connected";
      const accountEmail = row.account_email?.trim().toLowerCase();
      return {
        id: row.id,
        ...(accountEmail ? { accountEmail } : {}),
        connected,
        canSend: connected && Array.isArray(row.scopes) && row.scopes.includes(GMAIL_SEND_SCOPE),
      };
    }),
    ...(input.integrationId ? { integrationId: input.integrationId } : {}),
  });
  if (resolution.kind === "needs_choice") {
    throw new SenderIdentityUnavailable(
      "needs_choice",
      "More than one mailbox can send here. Choose which account this message goes out from before reviewing it.",
    );
  }
  if (resolution.kind !== "resolved") {
    throw new SenderIdentityUnavailable(
      "no_mailbox",
      "No mailbox is connected that can send, so there is no sending address to review against.",
    );
  }
  const email = (resolution.connection.accountEmail ?? "").toLowerCase();
  if (!email) {
    throw new SenderIdentityUnavailable(
      "no_mailbox",
      "The connected mailbox has no address on record.",
    );
  }
  return email;
}
