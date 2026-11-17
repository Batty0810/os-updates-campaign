-- Access list: only approved, signed-in email addresses can see data.
--   admin  = view + edit + export
--   editor = view + edit
--   viewer = view only

create table app_users (
  email  text primary key check (email = lower(email)),
  role   text not null check (role in ('admin', 'editor', 'viewer'))
);
alter table app_users enable row level security;

-- Role of the signed-in user (null if not on the list). security definer so policies can read app_users.
create or replace function app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from app_users where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
create or replace function can_view() returns boolean language sql stable as $$ select app_role() is not null $$;
create or replace function can_edit() returns boolean language sql stable as $$ select app_role() in ('admin', 'editor') $$;

-- Users can see their own access entry (the app uses it to decide what to show).
create policy "read own access" on app_users
  for select to authenticated using (email = lower(auth.jwt() ->> 'email'));

-- Replace public read with approved-users read.
drop policy "public read customers" on customers;
drop policy "public read vms" on vms;
drop policy "public read meetings" on meetings;
create policy "approved read customers" on customers for select to authenticated using (can_view());
create policy "approved read vms"       on vms       for select to authenticated using (can_view());
create policy "approved read meetings"  on meetings  for select to authenticated using (can_view());

-- Writes: editors and admins only (replaces the @nymbis.cloud domain check).
drop policy "staff insert meetings" on meetings;
drop policy "staff update meetings" on meetings;
drop policy "staff delete meetings" on meetings;
drop policy "staff update vms" on vms;
create policy "editors insert meetings" on meetings for insert to authenticated with check (can_edit());
create policy "editors update meetings" on meetings for update to authenticated using (can_edit()) with check (can_edit());
create policy "editors delete meetings" on meetings for delete to authenticated using (can_edit());
create policy "editors update vms"      on vms      for update to authenticated using (can_edit()) with check (can_edit());
drop function is_nymbis_staff();

-- Make sure anonymous visitors can't call the helper functions either.
revoke execute on function app_role(), can_view(), can_edit() from anon, public;
grant execute on function app_role(), can_view(), can_edit() to authenticated;
