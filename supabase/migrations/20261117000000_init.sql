-- OS Updates Campaign: initial schema
-- Source: "Contact List.xlsx" (Sheet1). IP addresses are intentionally not stored.

create type vm_status as enum ('red', 'orange', 'blue');

create table customers (
  id              bigint generated always as identity primary key,
  name            text not null unique,
  account_manager text not null,
  created_at      timestamptz not null default now()
);

create table vms (
  id              bigint generated always as identity primary key,
  customer_id     bigint not null references customers (id) on delete cascade,
  vm_name         text not null unique,
  status          vm_status,               -- null = not yet assessed
  hw_version      smallint,
  os_config       text,                    -- OS according to the VM configuration file
  os_tools        text,                    -- OS according to VMware Tools (null if Tools not running)
  contact_date    date,
  am_notes        text,
  updated_at      timestamptz not null default now()
);

create index vms_customer_id_idx on vms (customer_id);
create index vms_status_idx on vms (status);

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger vms_set_updated_at
  before update on vms
  for each row execute function set_updated_at();

-- Row Level Security: anyone can read (public read-only app). Only signed-in users can update.
alter table customers enable row level security;
alter table vms       enable row level security;

create policy "public read customers" on customers
  for select to anon, authenticated using (true);

create policy "public read vms" on vms
  for select to anon, authenticated using (true);

create policy "authenticated update vms" on vms
  for update to authenticated using (true) with check (true);
