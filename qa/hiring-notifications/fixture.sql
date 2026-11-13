-- Minimal isolated shape ONLY; not a reproduction of hosted Hiring schema.
create role anon;
create role authenticated;
create table public.hiring_runtime(id boolean primary key, intake_enabled boolean not null);
insert into public.hiring_runtime values(true,true);
create table public.career_delivery_outbox(id uuid primary key, status text not null);
insert into public.career_delivery_outbox values
 ('11111111-1111-4111-8111-111111111111','delivered'),
 ('22222222-2222-4222-8222-222222222222','failed');