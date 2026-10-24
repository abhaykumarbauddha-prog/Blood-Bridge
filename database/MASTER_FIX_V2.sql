-- ============================================================
-- BLOOD BRIDGE - MASTER FIX V2 (FIXED VERSION)
-- Supabase Dashboard > SQL Editor mein yeh poora paste karo
-- ============================================================

-- ========================
-- PART A: CLEAN SLATE (sab purana hata do)
-- ========================

drop view if exists public.public_donors cascade;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists sync_donor_truth_before_write on public.users;

drop function if exists public.handle_new_user() cascade;
drop function if exists public.sync_donor_truth() cascade;
drop function if exists public.user_has_role(text) cascade;
drop function if exists public.blood_group_compatible(text, text) cascade;
drop function if exists public.get_public_platform_stats() cascade;
drop function if exists public.accept_blood_request(uuid) cascade;
drop function if exists public.mark_response_donated(uuid) cascade;
drop function if exists public.expire_open_blood_requests() cascade;
drop function if exists public.notify_matching_donors() cascade;
drop function if exists public.notify_response_events() cascade;
drop function if exists public.validate_blood_request_lifecycle() cascade;
drop function if exists public.get_request_contact(uuid) cascade;
drop function if exists public.touch_blood_inventory_updated_at() cascade;
drop function if exists public.touch_user_settings_updated_at() cascade;

drop table if exists public.support_messages cascade;
drop table if exists public.user_settings cascade;
drop table if exists public.blood_inventory cascade;
drop table if exists public.notifications cascade;
drop table if exists public.request_responses cascade;
drop table if exists public.blood_requests cascade;
drop table if exists public.hospital_inventory cascade;
drop table if exists public.user_roles cascade;
drop table if exists public.users cascade;

-- ========================
-- PART B: FRESH TABLES
-- ========================

create table public.users (
  id uuid references auth.users(id) on delete cascade not null primary key,
  full_name text not null,
  phone text not null default '',
  role text not null default 'Donor' check (role in ('Donor', 'Requester', 'Hospital', 'Admin')),
  blood_group text,
  city text,
  date_of_birth date,
  gender text,
  address text,
  state text,
  pincode text,
  country text default 'India',
  avatar_url text,
  last_donation_date date,
  weight_kg numeric,
  medical_conditions text,
  availability_status text default 'Available',
  website text,
  hospital_type text,
  verification_status text,
  is_donor boolean not null default false,
  is_available boolean not null default false,
  latitude double precision,
  longitude double precision,
  created_at timestamptz default timezone('utc', now()) not null
);

create table public.blood_requests (
  id uuid default gen_random_uuid() primary key,
  patient_name text not null,
  blood_group text not null,
  units integer not null,
  urgency text not null,
  hospital_name text not null,
  hospital_address text not null,
  city text not null,
  required_date date,
  required_time time,
  required_by timestamptz,
  additional_info text,
  requester_id uuid references auth.users(id) on delete cascade not null,
  status text default 'open',
  latitude double precision,
  longitude double precision,
  created_at timestamptz default timezone('utc', now()) not null
);

create table public.hospital_inventory (
  id uuid default gen_random_uuid() primary key,
  hospital_id uuid references auth.users(id) on delete cascade not null,
  blood_group text not null,
  units integer default 0,
  last_updated timestamptz default timezone('utc', now()) not null,
  unique(hospital_id, blood_group)
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('Donor', 'Requester', 'Hospital', 'Admin')),
  created_at timestamptz not null default timezone('utc', now())
);

create table public.request_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.blood_requests(id) on delete cascade,
  donor_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted', 'donated', 'declined', 'no_show')),
  donated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (request_id, donor_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table public.blood_inventory (
  hospital_id uuid not null references auth.users(id) on delete cascade,
  blood_group text not null check (blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
  units integer not null default 0 check (units >= 0),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (hospital_id, blood_group)
);

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  subject text not null check (char_length(trim(subject)) between 1 and 120),
  message text not null check (char_length(trim(message)) between 1 and 5000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default timezone('utc', now())
);

-- ========================
-- PART C: HELPER FUNCTIONS
-- ========================

create or replace function public.user_has_role(required_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = required_role
  );
$$;

create or replace function public.blood_group_compatible(donor_group text, recipient_group text)
returns boolean language sql immutable as $$
  select case donor_group
    when 'O-' then recipient_group in ('O-','O+','A-','A+','B-','B+','AB-','AB+')
    when 'O+' then recipient_group in ('O+','A+','B+','AB+')
    when 'A-' then recipient_group in ('A-','A+','AB-','AB+')
    when 'A+' then recipient_group in ('A+','AB+')
    when 'B-' then recipient_group in ('B-','B+','AB-','AB+')
    when 'B+' then recipient_group in ('B+','AB+')
    when 'AB-' then recipient_group in ('AB-','AB+')
    when 'AB+' then recipient_group = 'AB+'
    else false
  end;
$$;

-- ========================
-- PART D: TRIGGERS
-- ========================

create or replace function public.sync_donor_truth()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.is_donor := coalesce(new.is_donor, new.role = 'Donor');
    new.is_available := coalesce(new.is_available, lower(coalesce(new.availability_status,'')) = 'available');
  else
    if new.role is distinct from old.role and new.is_donor is not distinct from old.is_donor then
      new.is_donor := (new.role = 'Donor');
    end if;
    if new.availability_status is distinct from old.availability_status and new.is_available is not distinct from old.is_available then
      new.is_available := (lower(coalesce(new.availability_status,'')) = 'available');
    end if;
  end if;
  if new.is_available then
    new.availability_status := 'Available';
  elsif new.availability_status is null or lower(new.availability_status) = 'available' then
    new.availability_status := 'Unavailable';
  end if;
  return new;
end;
$$;

create trigger sync_donor_truth_before_write
before insert or update of role, availability_status, is_donor, is_available
on public.users for each row execute function public.sync_donor_truth();

-- SIGNUP FIX: handle_new_user trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  assigned_role text;
begin
  assigned_role := case
    when new.raw_user_meta_data->>'role' in ('Donor','Requester','Hospital')
      then new.raw_user_meta_data->>'role'
    else 'Donor'
  end;

  insert into public.users (id, full_name, phone, role, is_donor, is_available)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'New User'),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    assigned_role,
    (assigned_role = 'Donor'),
    false
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, assigned_role)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ========================
-- PART E: RLS POLICIES
-- ========================

alter table public.users enable row level security;
alter table public.blood_requests enable row level security;
alter table public.hospital_inventory enable row level security;
alter table public.user_roles enable row level security;
alter table public.request_responses enable row level security;
alter table public.notifications enable row level security;
alter table public.blood_inventory enable row level security;
alter table public.user_settings enable row level security;
alter table public.support_messages enable row level security;

-- users
create policy "Anyone authenticated can view profiles"
  on public.users for select to authenticated using (true);
create policy "Users can update own profile"
  on public.users for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users can insert own profile"
  on public.users for insert to authenticated with check (auth.uid() = id);

-- blood_requests
create policy "Anyone authenticated can view requests"
  on public.blood_requests for select to authenticated using (true);
create policy "Users can create own requests"
  on public.blood_requests for insert to authenticated
  with check (auth.uid() = requester_id);
create policy "Users can update own requests"
  on public.blood_requests for update to authenticated
  using (auth.uid() = requester_id);

-- hospital_inventory
create policy "Anyone authenticated can view inventory"
  on public.hospital_inventory for select to authenticated using (true);
create policy "Hospitals manage own inventory"
  on public.hospital_inventory for all to authenticated
  using (auth.uid() = hospital_id) with check (auth.uid() = hospital_id);

-- user_roles
create policy "Users read own role"
  on public.user_roles for select to authenticated
  using (user_id = auth.uid());

-- request_responses
create policy "Users read relevant responses"
  on public.request_responses for select to authenticated
  using (
    donor_id = auth.uid()
    or exists (
      select 1 from public.blood_requests br
      where br.id = request_responses.request_id and br.requester_id = auth.uid()
    )
  );
create policy "Donors create responses"
  on public.request_responses for insert to authenticated
  with check (donor_id = auth.uid() and status = 'accepted');

-- notifications
create policy "Users read own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy "Users update own notifications"
  on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- blood_inventory
create policy "Hospitals read own blood inventory"
  on public.blood_inventory for select to authenticated
  using (hospital_id = auth.uid());
create policy "Hospitals manage own blood inventory"
  on public.blood_inventory for all to authenticated
  using (hospital_id = auth.uid()) with check (hospital_id = auth.uid());

-- user_settings
create policy "Users read own settings"
  on public.user_settings for select to authenticated
  using (user_id = auth.uid());
create policy "Users manage own settings"
  on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- support_messages
create policy "Users create own support messages"
  on public.support_messages for insert to authenticated
  with check (user_id = auth.uid());
create policy "Users read own support messages"
  on public.support_messages for select to authenticated
  using (user_id = auth.uid());

-- ========================
-- PART F: PUBLIC VIEW
-- ========================

create view public.public_donors as
  select id, full_name, blood_group, city, state, avatar_url,
         availability_status, last_donation_date, is_donor, is_available, latitude, longitude
  from public.users where is_donor = true;

grant select on public.public_donors to authenticated;

-- ========================
-- PART G: STATS FUNCTION
-- ========================

create or replace function public.get_public_platform_stats()
returns table (active_donors bigint, verified_hospitals bigint, fulfilled_donations bigint)
language sql stable security definer set search_path = public as $$
  select
    (select count(*) from public.users where is_donor = true and is_available = true),
    (select count(*) from public.users where role = 'Hospital' and verification_status = 'verified'),
    (select count(*) from public.request_responses where status = 'donated');
$$;

revoke all on function public.get_public_platform_stats() from public;
grant execute on function public.get_public_platform_stats() to anon, authenticated;

-- ========================
-- PART H: STORAGE BUCKET
-- ========================

insert into storage.buckets (id, name, public)
values ('userprofilephotos', 'userprofilephotos', true)
on conflict (id) do update set public = true;

drop policy if exists "Anyone can view profile photos" on storage.objects;
create policy "Anyone can view profile photos"
  on storage.objects for select using (bucket_id = 'userprofilephotos');

drop policy if exists "Users can upload their profile photos" on storage.objects;
create policy "Users can upload their profile photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'userprofilephotos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can update their profile photos" on storage.objects;
create policy "Users can update their profile photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'userprofilephotos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'userprofilephotos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users can delete their profile photos" on storage.objects;
create policy "Users can delete their profile photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'userprofilephotos' and (storage.foldername(name))[1] = auth.uid()::text);

-- ========================
-- DONE — RELOAD SCHEMA
-- ========================
notify pgrst, 'reload schema';

-- Verify karo: yeh query run karke check karo sab tables bani ki nahi
select table_name from information_schema.tables
where table_schema = 'public'
order by table_name;
