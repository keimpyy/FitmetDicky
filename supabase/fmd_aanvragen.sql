-- Public appointment requests for the Next app.
-- Run this in Supabase SQL editor.

create table if not exists public.fmd_aanvragen (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.fmd_aanvragen enable row level security;

drop policy if exists "Anyone can create appointment requests" on public.fmd_aanvragen;
drop policy if exists "Authenticated can view appointment requests" on public.fmd_aanvragen;
drop policy if exists "Authenticated can update appointment requests" on public.fmd_aanvragen;
drop policy if exists "Authenticated can delete appointment requests" on public.fmd_aanvragen;

create policy "Anyone can create appointment requests" on public.fmd_aanvragen
for insert to anon, authenticated with check (true);

create policy "Authenticated can view appointment requests" on public.fmd_aanvragen
for select to authenticated using (true);

create policy "Authenticated can update appointment requests" on public.fmd_aanvragen
for update to authenticated using (true) with check (true);

create policy "Authenticated can delete appointment requests" on public.fmd_aanvragen
for delete to authenticated using (true);
