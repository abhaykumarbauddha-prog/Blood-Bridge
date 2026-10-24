-- Phase 5 donor/location correctness. Idempotent and non-destructive.

alter table public.users add column if not exists is_donor boolean;
alter table public.users add column if not exists is_available boolean;
alter table public.users add column if not exists latitude double precision;
alter table public.users add column if not exists longitude double precision;

update public.users
set is_donor = (role = 'Donor')
where is_donor is null;

update public.users
set is_available = (lower(coalesce(availability_status, '')) = 'available')
where is_available is null;

alter table public.users alter column is_donor set default false;
alter table public.users alter column is_available set default false;
alter table public.users alter column is_donor set not null;
alter table public.users alter column is_available set not null;

create or replace function public.sync_donor_truth()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.is_donor := coalesce(new.is_donor, new.role = 'Donor');
    new.is_available := coalesce(new.is_available, lower(coalesce(new.availability_status, '')) = 'available');
  else
    if new.role is distinct from old.role and new.is_donor is not distinct from old.is_donor then
      new.is_donor := (new.role = 'Donor');
    end if;
    if new.availability_status is distinct from old.availability_status and new.is_available is not distinct from old.is_available then
      new.is_available := (lower(coalesce(new.availability_status, '')) = 'available');
    end if;
  end if;
  if new.is_available then new.availability_status := 'Available';
  elsif new.availability_status is null or lower(new.availability_status) = 'available' then new.availability_status := 'Unavailable';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_donor_truth_before_write on public.users;
create trigger sync_donor_truth_before_write
before insert or update of role, availability_status, is_donor, is_available
on public.users
for each row execute function public.sync_donor_truth();

revoke update (is_donor) on table public.users from authenticated;

create or replace view public.public_donors as
  select id, full_name, blood_group, city, state, avatar_url, availability_status,
         last_donation_date, is_donor, is_available, latitude, longitude
  from public.users
  where is_donor = true;

grant select on public.public_donors to authenticated;
notify pgrst, 'reload schema';
