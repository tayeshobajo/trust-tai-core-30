-- Blog posts published from Studio to trusttai.com.
-- The publisher edge function (service role) is the only writer; the public
-- site reads via anon. A row here IS the published article of record.
create table if not exists public.published_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  publish_key text not null unique,
  slug text not null unique,
  title text not null,
  seo_title text,
  meta_description text,
  body_markdown text not null,
  category text,
  tags jsonb not null default '[]'::jsonb,
  image jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.published_posts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'published_posts' and policyname = 'Anyone reads published posts') then
    create policy "Anyone reads published posts" on public.published_posts
      for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'published_posts' and policyname = 'published_posts_service_role') then
    create policy "published_posts_service_role" on public.published_posts
      as permissive for all to service_role using (true) with check (true);
  end if;
end $$;

create index if not exists published_posts_published_at_idx
  on public.published_posts (published_at desc);
