-- Fit met Dicky Planner RLS policies.
-- Run after creating fmd_planner_settings, fmd_klanten, and fmd_afspraken.

alter table public.fmd_planner_settings enable row level security;
alter table public.fmd_klanten enable row level security;
alter table public.fmd_afspraken enable row level security;

drop policy if exists "Owner can view planner settings" on public.fmd_planner_settings;
drop policy if exists "Owner can create planner settings" on public.fmd_planner_settings;
drop policy if exists "Owner can update planner settings" on public.fmd_planner_settings;
drop policy if exists "Owner can delete planner settings" on public.fmd_planner_settings;

create policy "Owner can view planner settings" on public.fmd_planner_settings
for select to authenticated using (user_id = (select auth.uid()));
create policy "Owner can create planner settings" on public.fmd_planner_settings
for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owner can update planner settings" on public.fmd_planner_settings
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owner can delete planner settings" on public.fmd_planner_settings
for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Owner can view klanten" on public.fmd_klanten;
drop policy if exists "Owner can create klanten" on public.fmd_klanten;
drop policy if exists "Owner can update klanten" on public.fmd_klanten;
drop policy if exists "Owner can delete klanten" on public.fmd_klanten;

create policy "Owner can view klanten" on public.fmd_klanten
for select to authenticated using (user_id = (select auth.uid()));
create policy "Owner can create klanten" on public.fmd_klanten
for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owner can update klanten" on public.fmd_klanten
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owner can delete klanten" on public.fmd_klanten
for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Owner can view afspraken" on public.fmd_afspraken;
drop policy if exists "Owner can create afspraken" on public.fmd_afspraken;
drop policy if exists "Owner can update afspraken" on public.fmd_afspraken;
drop policy if exists "Owner can delete afspraken" on public.fmd_afspraken;

create policy "Owner can view afspraken" on public.fmd_afspraken
for select to authenticated using (user_id = (select auth.uid()));
create policy "Owner can create afspraken" on public.fmd_afspraken
for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Owner can update afspraken" on public.fmd_afspraken
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Owner can delete afspraken" on public.fmd_afspraken
for delete to authenticated using (user_id = (select auth.uid()));