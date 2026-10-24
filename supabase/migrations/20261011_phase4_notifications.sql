-- Phase 4 notifications. Idempotent and non-destructive.

alter table public.users add column if not exists latitude double precision;
alter table public.users add column if not exists longitude double precision;
alter table public.blood_requests add column if not exists latitude double precision;
alter table public.blood_requests add column if not exists longitude double precision;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.notifications enable row level security;
drop policy if exists "Users can read their own notifications" on public.notifications;
create policy "Users can read their own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Users can mark their own notifications read" on public.notifications;
create policy "Users can mark their own notifications read"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at desc);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_rel pr
       join pg_class c on c.oid = pr.prrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_publication p on p.oid = pr.prpubid
       where p.pubname = 'supabase_realtime'
         and n.nspname = 'public'
         and c.relname = 'notifications'
     ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

create or replace function public.notify_matching_donors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare donor record;
begin
  if new.latitude is null or new.longitude is null then return new; end if;

  for donor in
    select u.id
    from public.users u
    where u.role = 'Donor'
      and lower(coalesce(u.availability_status, '')) = 'available'
      and u.latitude is not null and u.longitude is not null
      and public.blood_group_compatible(u.blood_group, new.blood_group)
      and (
        6371 * acos(least(1, greatest(-1,
          cos(radians(new.latitude)) * cos(radians(u.latitude)) *
          cos(radians(u.longitude) - radians(new.longitude)) +
          sin(radians(new.latitude)) * sin(radians(u.latitude))
        )))
      ) <= 100
  loop
    insert into public.notifications (user_id, type, title, body, link)
    values (
      donor.id,
      'request',
      'Blood request near you',
      format('%s blood is needed at %s.', new.blood_group, new.hospital_name),
      'nearby-request.html'
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists blood_request_matching_notifications on public.blood_requests;
create trigger blood_request_matching_notifications
after insert on public.blood_requests
for each row execute function public.notify_matching_donors();

create or replace function public.notify_response_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare request_row public.blood_requests;
declare donated_count integer;
begin
  select * into request_row from public.blood_requests where id = new.request_id;

  if tg_op = 'INSERT' and new.status = 'accepted' then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      request_row.requester_id,
      'response',
      'A donor accepted your request',
      'A compatible donor has accepted your blood request.',
      'blood-request.html'
    );
  elsif tg_op = 'UPDATE' and old.status <> 'donated' and new.status = 'donated' then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      request_row.requester_id,
      'system',
      'Donation verified',
      'Your blood request has been marked as donated.',
      'donation-history.html'
    );

    select count(*) into donated_count
    from public.request_responses
    where donor_id = new.donor_id and status = 'donated';

    if donated_count in (1, 5, 10) then
      insert into public.notifications (user_id, type, title, body, link)
      values (
        new.donor_id,
        'badge_earned',
        'Donor badge earned',
        format('You reached %s verified donation%s.', donated_count, case when donated_count = 1 then '' else 's' end),
        'my-profile.html'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists request_response_notifications on public.request_responses;
create trigger request_response_notifications
after insert or update on public.request_responses
for each row execute function public.notify_response_events();

revoke all on function public.notify_matching_donors() from public;
revoke all on function public.notify_response_events() from public;

notify pgrst, 'reload schema';
