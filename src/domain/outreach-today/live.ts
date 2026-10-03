export const ZONE = "America/Chicago";
export function chicagoDay(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function dayBounds(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error("Invalid reporting date");
  const midnight = (d: string) => {
    let time = Date.parse(`${d}T00:00:00Z`);
    for (let i = 0; i < 3; i++) {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(time));
      const p = Object.fromEntries(parts.map(v => [v.type, v.value]));
      const local = Date.parse(`${p["year"]}-${p["month"]}-${p["day"]}T${p["hour"]}:${p["minute"]}:${p["second"]}Z`);
      time += Date.parse(`${d}T00:00:00Z`) - local;
    }
    return new Date(time).toISOString();
  };
  const next = new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return { start: midnight(day), end: midnight(next) };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 512;
const email = (v: unknown): v is string => text(v) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export type Observation = { key: string; at: string; from: string; mailbox: string | null; relationship: string | null; thread: string | null };
export function projectOutbound(input: unknown[], organizationId: string, day: string) {
  dayBounds(day);
  const seen = new Map<string, Observation>();
  const held = new Set<string>();
  let rejected = 0;
  for (const raw of input) {
    if (!object(raw) || raw["organization_id"] !== organizationId || raw["direction"] !== "outbound" || !text(raw["provider"]) || !text(raw["provider_message_id"])) { rejected++; continue; }
    const key = JSON.stringify([organizationId, raw["provider"], raw["provider_message_id"]]);
    const reject = () => { rejected++; held.add(key); seen.delete(key); };
    if (!text(raw["occurred_at"]) || !/(Z|[+-]\d{2}:\d{2})$/.test(raw["occurred_at"]) || !Number.isFinite(Date.parse(raw["occurred_at"])) || chicagoDay(new Date(raw["occurred_at"])) !== day || !email(raw["from_email"])) { reject(); continue; }
    if (raw["provenance"] !== null && raw["provenance"] !== undefined && !object(raw["provenance"])) { reject(); continue; }
    const provenance = object(raw["provenance"]) ? raw["provenance"] : {};
    const mailbox = provenance["mailbox"];
    if (mailbox != null && (!email(mailbox) || mailbox.toLowerCase() !== raw["from_email"].toLowerCase())) { reject(); continue; }
    if ((raw["relationship_id"] != null && !text(raw["relationship_id"])) || (raw["thread_id"] != null && !text(raw["thread_id"]))) { reject(); continue; }
    const row: Observation = { key, at: new Date(raw["occurred_at"]).toISOString(), from: raw["from_email"].toLowerCase(), mailbox: typeof mailbox === "string" ? mailbox.toLowerCase() : null, relationship: typeof raw["relationship_id"] === "string" ? raw["relationship_id"] : null, thread: typeof raw["thread_id"] === "string" ? raw["thread_id"] : null };
    if (held.has(key)) continue;
    const previous = seen.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) { reject(); continue; }
    seen.set(key, row);
  }
  return { rows: [...seen.values()].sort((a,b) => b.at.localeCompare(a.at)), rejected, conflicts: held.size };
}
