-- An approved draft may carry a rendered HTML alternative alongside its
-- plain text. Nullable: a draft without one sends exactly as before.
alter table public.comms_drafts
  add column if not exists body_html text;
