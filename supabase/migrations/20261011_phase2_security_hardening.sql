-- Phase 2 security hardening. Idempotent and non-destructive.

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('Donor', 'Requester', 'Hospital', 'Admin')),
  created_at timestamptz not null default timezone('utc', now())
);

insert into public.user_roles (user_id, role)
select id, role
from public.users
where role in ('Donor', 'Requester', 'Hospital', 'Admin')
on conflict (user_id) do nothing;

alter table public.user_roles enable row level security;
drop policy if exists "Users can read their own role" on public.user_roles;
create policy "Users can read their own role"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());

create or replace function public.user_has_role(required_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = required_role
  );
$$;

revoke all on function public.user_has_role(text) from public;
grant execute on function public.user_has_role(text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare assigned_role text;
begin
  assigned_role := case
    when new.raw_user_meta_data ->> 'role' in ('Donor', 'Requester', 'Hospital')
      then new.raw_user_meta_data ->> 'role'
    else 'Donor'
  end;

  insert into public.users (id, full_name, phone, role)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', 'New User'), coalesce(new.raw_user_meta_data ->> 'phone', ''), assigned_role)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, assigned_role)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

alter table public.users enable row level security;
drop policy if exists "Authenticated users can view profiles" on public.users;
drop policy if exists "Users can update their own profile" on public.users;
drop policy if exists "Users can create their own profile" on public.users;

create policy "Users can read their own profile"
  on public.users for select to authenticated
  using (auth.uid() = id);

create policy "Users can update their own profile without changing role"
  on public.users for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select ur.role from public.user_roles ur where ur.user_id = auth.uid())
  );

create policy "Users can create a donor profile"
  on public.users for insert to authenticated
  with check (auth.uid() = id and role = 'Donor');

revoke update (role) on table public.users from authenticated;

create or replace view public.public_donors as
  select id, full_name, blood_group, city, state, avatar_url, availability_status, last_donation_date
  from public.users
  where role = 'Donor';
revoke all on public.public_donors from anon;
grant select on public.public_donors to authenticated;

alter table public.blood_requests enable row level security;
drop policy if exists "Authenticated users can view blood requests" on public.blood_requests;
drop policy if exists "Users can create their own blood requests" on public.blood_requests;
drop policy if exists "Requesters can update their own blood requests" on public.blood_requests;

create policy "Authenticated users can view open blood requests"
  on public.blood_requests for select to authenticated
  using (
    lower(coalesce(status, '')) in ('open', 'pending', 'urgent', 'critical', 'matched')
    or requester_id = auth.uid()
    or public.user_has_role('Admin')
  );

create policy "Authenticated users can create their own blood requests"
  on public.blood_requests for insert to authenticated
  with check (requester_id = auth.uid());

create policy "Owners hospitals and admins can update blood requests"
  on public.blood_requests for update to authenticated
  using (
    requester_id = auth.uid()
    or public.user_has_role('Admin')
    or (
      public.user_has_role('Hospital')
      and exists (
        select 1 from public.users u
        where u.id = auth.uid() and u.full_name = blood_requests.hospital_name
      )
    )
  )
  with check (
    requester_id = auth.uid()
    or public.user_has_role('Admin')
    or (
      public.user_has_role('Hospital')
      and exists (
        select 1 from public.users u
        where u.id = auth.uid() and u.full_name = blood_requests.hospital_name
      )
    )
  );

alter table public.hospital_inventory enable row level security;
drop policy if exists "Authenticated users can view inventory" on public.hospital_inventory;
drop policy if exists "Hospitals can manage their inventory" on public.hospital_inventory;

create policy "Hospitals and admins can view inventory"
  on public.hospital_inventory for select to authenticated
  using (hospital_id = auth.uid() or public.user_has_role('Admin'));

create policy "Hospitals and admins can manage inventory"
  on public.hospital_inventory for all to authenticated
  using (hospital_id = auth.uid() or public.user_has_role('Admin'))
  with check (hospital_id = auth.uid() or public.user_has_role('Admin'));

alter table storage.objects enable row level security;

notify pgrst, 'reload schema';
