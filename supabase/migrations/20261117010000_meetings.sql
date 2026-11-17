-- Customer meetings: account managers book one meeting per customer with a Nymbis attendee.

create table meetings (
  id            bigint generated always as identity primary key,
  customer_id   bigint not null unique references customers (id) on delete cascade,
  attendee      text not null check (attendee in
                  ('Sean Rose', 'Daniel Martins', 'Jimmy Mokwena', 'Jose van der Merwe', 'Brendon Atwell')),
  meeting_date  date not null,
  completed     boolean not null default false,
  comment       text,
  updated_by    text default (auth.jwt() ->> 'email'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint comment_required_when_completed
    check (not completed or length(trim(coalesce(comment, ''))) > 0)
);

create or replace function set_meeting_audit() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = auth.jwt() ->> 'email';
  return new;
end $$;

create trigger meetings_audit
  before insert or update on meetings
  for each row execute function set_meeting_audit();

-- Only signed-in Nymbis staff may write.
create or replace function is_nymbis_staff() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@nymbis.cloud'
$$;

alter table meetings enable row level security;

create policy "public read meetings" on meetings
  for select to anon, authenticated using (true);
create policy "staff insert meetings" on meetings
  for insert to authenticated with check (is_nymbis_staff());
create policy "staff update meetings" on meetings
  for update to authenticated using (is_nymbis_staff()) with check (is_nymbis_staff());
create policy "staff delete meetings" on meetings
  for delete to authenticated using (is_nymbis_staff());

-- Tighten the existing VM update policy to Nymbis staff as well.
drop policy "authenticated update vms" on vms;
create policy "staff update vms" on vms
  for update to authenticated using (is_nymbis_staff()) with check (is_nymbis_staff());
