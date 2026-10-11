-- 1. Users Table (Stores user roles, profile data, and donor health info)
create table if not exists public.users (
  id uuid references auth.users not null primary key,
  full_name text not null,
  phone text not null,
  role text not null, -- 'Donor', 'Requester', 'Hospital', 'Admin'
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
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Add profile fields when upgrading an existing users table.
alter table public.users add column if not exists date_of_birth date;
alter table public.users add column if not exists gender text;
alter table public.users add column if not exists address text;
alter table public.users add column if not exists state text;
alter table public.users add column if not exists pincode text;
alter table public.users add column if not exists country text default 'India';
alter table public.users add column if not exists weight_kg numeric;
alter table public.users add column if not exists medical_conditions text;
alter table public.users add column if not exists avatar_url text;

-- 2. Blood Requests Table (Stores all blood emergencies)
create table if not exists public.blood_requests (
  id uuid default gen_random_uuid() primary key,
  patient_name text not null,
  blood_group text not null,
  units integer not null,
  urgency text not null,
  hospital_name text not null,
  hospital_address text not null,
  city text not null,
  required_date date not null,
  required_time time not null,
  additional_info text,
  requester_id uuid references auth.users not null,
  status text default 'Pending', -- 'Pending', 'Urgent', 'Critical', 'Fulfilled'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Hospital Inventory Table (Stores blood stock for hospitals)
create table if not exists public.hospital_inventory (
  id uuid default gen_random_uuid() primary key,
  hospital_id uuid references auth.users not null,
  blood_group text not null,
  units integer default 0,
  last_updated timestamp with time zone default timezone('utc'::text, now()) not null,
  unique(hospital_id, blood_group) -- Prevents duplicate entries for same blood group per hospital
);

-- Create a profile automatically when a Supabase Auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', 'New User'),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case
      when new.raw_user_meta_data ->> 'role' in ('Donor', 'Requester', 'Hospital')
        then new.raw_user_meta_data ->> 'role'
      else 'Donor'
    end
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS policies for authenticated application users.
alter table public.users enable row level security;
alter table public.blood_requests enable row level security;
alter table public.hospital_inventory enable row level security;

drop policy if exists "Authenticated users can view profiles" on public.users;
create policy "Authenticated users can view profiles"
  on public.users for select to authenticated using (true);

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Users can create their own profile" on public.users;
create policy "Users can create their own profile"
  on public.users for insert to authenticated with check (auth.uid() = id);

drop policy if exists "Authenticated users can view blood requests" on public.blood_requests;
create policy "Authenticated users can view blood requests"
  on public.blood_requests for select to authenticated using (true);

drop policy if exists "Users can create their own blood requests" on public.blood_requests;
create policy "Users can create their own blood requests"
  on public.blood_requests for insert to authenticated with check (auth.uid() = requester_id);

drop policy if exists "Requesters can update their own blood requests" on public.blood_requests;
create policy "Requesters can update their own blood requests"
  on public.blood_requests for update to authenticated using (auth.uid() = requester_id);

drop policy if exists "Authenticated users can view inventory" on public.hospital_inventory;
create policy "Authenticated users can view inventory"
  on public.hospital_inventory for select to authenticated using (true);

drop policy if exists "Hospitals can manage their inventory" on public.hospital_inventory;
create policy "Hospitals can manage their inventory"
  on public.hospital_inventory for all to authenticated
  using (auth.uid() = hospital_id) with check (auth.uid() = hospital_id);

-- Refresh PostgREST's schema cache after applying this migration in Supabase.
notify pgrst, 'reload schema';

-- Public profile photos. The folder name must be the authenticated user's id.
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
