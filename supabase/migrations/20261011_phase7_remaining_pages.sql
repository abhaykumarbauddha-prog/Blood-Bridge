-- Phase 7: user preferences and support messages.
-- Run this migration in Supabase SQL Editor after phases 2-6.

create table if not exists public.user_settings (
    user_id uuid primary key references auth.users(id) on delete cascade,
    preferences jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.touch_user_settings_updated_at()
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

drop trigger if exists user_settings_updated_at on public.user_settings;
create trigger user_settings_updated_at
before update on public.user_settings
for each row execute function public.touch_user_settings_updated_at();

alter table public.user_settings enable row level security;
drop policy if exists "Users can read their own settings" on public.user_settings;
create policy "Users can read their own settings"
on public.user_settings for select to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can manage their own settings" on public.user_settings;
create policy "Users can manage their own settings"
on public.user_settings for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create table if not exists public.support_messages (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    email text,
    subject text not null check (char_length(trim(subject)) between 1 and 120),
    message text not null check (char_length(trim(message)) between 1 and 5000),
    status text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists support_messages_user_id_idx
on public.support_messages (user_id, created_at desc);

drop policy if exists "Donors can read requests they donated to" on public.blood_requests;
create policy "Donors can read requests they donated to"
on public.blood_requests for select to authenticated
using (
    exists (
        select 1
        from public.request_responses rr
        where rr.request_id = blood_requests.id
          and rr.donor_id = auth.uid()
          and rr.status = 'donated'
    )
);

alter table public.support_messages enable row level security;
drop policy if exists "Users can create their own support messages" on public.support_messages;
create policy "Users can create their own support messages"
on public.support_messages for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can read their own support messages" on public.support_messages;
create policy "Users can read their own support messages"
on public.support_messages for select to authenticated
using (user_id = auth.uid());

notify pgrst, 'reload schema';
