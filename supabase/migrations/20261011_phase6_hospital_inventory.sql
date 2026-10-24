-- Phase 6: database-backed hospital inventory and profile fields.
-- Run this migration in Supabase SQL Editor after phases 2-5.

alter table public.users
    add column if not exists website text,
    add column if not exists hospital_type text,
    add column if not exists verification_status text;

create table if not exists public.blood_inventory (
    hospital_id uuid not null references auth.users(id) on delete cascade,
    blood_group text not null check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    units integer not null default 0 check (units >= 0),
    updated_at timestamptz not null default timezone('utc', now()),
    primary key (hospital_id, blood_group)
);

create index if not exists blood_inventory_hospital_id_idx
    on public.blood_inventory (hospital_id);

create or replace function public.touch_blood_inventory_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists blood_inventory_updated_at on public.blood_inventory;
create trigger blood_inventory_updated_at
before update on public.blood_inventory
for each row execute function public.touch_blood_inventory_updated_at();

alter table public.blood_inventory enable row level security;

drop policy if exists "Hospital owners and admins can read blood inventory" on public.blood_inventory;
create policy "Hospital owners and admins can read blood inventory"
on public.blood_inventory for select
to authenticated
using (
    (hospital_id = auth.uid() and public.user_has_role('Hospital'))
    or public.user_has_role('Admin')
);

drop policy if exists "Hospital owners and admins can manage blood inventory" on public.blood_inventory;
create policy "Hospital owners and admins can manage blood inventory"
on public.blood_inventory for all
to authenticated
using (
    (hospital_id = auth.uid() and public.user_has_role('Hospital'))
    or public.user_has_role('Admin')
)
with check (
    (hospital_id = auth.uid() and public.user_has_role('Hospital'))
    or public.user_has_role('Admin')
);

notify pgrst, 'reload schema';
