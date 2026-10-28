-- Admin dashboard security and aggregate metrics.
-- Admin privileges are assigned only by a trusted database/service-role workflow.

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  action text not null,
  target_type text,
  target_id uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_audit_logs_created_at_idx
  on public.admin_audit_logs (created_at desc);

create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs (target_type, target_id);

alter table public.admin_audit_logs enable row level security;

-- Normalize legacy profile policies from the initial schema. Admin must never
-- be self-assigned through a browser-authenticated users table write.
drop policy if exists "Users can insert own profile" on public.users;
drop policy if exists "Users can create a donor profile" on public.users;
drop policy if exists "Users can create their own profile" on public.users;
drop policy if exists "Users can create donor profile only" on public.users;
create policy "Users can create donor profile only"
  on public.users for insert to authenticated
  with check (auth.uid() = id and role = 'Donor');

revoke update (role) on public.users from authenticated;

drop policy if exists "Admins can read audit logs" on public.admin_audit_logs;
create policy "Admins can read audit logs"
  on public.admin_audit_logs for select to authenticated
  using (public.user_has_role('Admin'));

create or replace function public.get_admin_dashboard_stats()
returns table (
  total_users bigint,
  registered_donors bigint,
  available_donors bigint,
  open_requests bigint,
  critical_requests bigint,
  verified_hospitals bigint,
  successful_donations bigint,
  fulfilled_requests bigint,
  total_units_donated bigint,
  pending_support_messages bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.user_has_role('Admin') then
    raise exception 'Admin access required';
  end if;

  return query
  select
    (select count(*) from public.users),
    (select count(*) from public.users where role = 'Donor' or is_donor = true),
    (select count(*) from public.users where (role = 'Donor' or is_donor = true) and is_available = true),
    (select count(*) from public.blood_requests where lower(coalesce(status, 'open')) in ('open', 'pending', 'urgent', 'critical', 'matched')),
    (select count(*) from public.blood_requests where lower(coalesce(status, 'open')) in ('open', 'pending', 'urgent', 'critical', 'matched') and lower(coalesce(urgency, 'normal')) = 'critical'),
    (select count(*) from public.users where role = 'Hospital' and lower(coalesce(verification_status, '')) = 'verified'),
    (select count(*) from public.request_responses where status = 'donated'),
    (select count(*) from public.blood_requests where lower(coalesce(status, '')) = 'fulfilled'),
    (select coalesce(sum(br.units), 0)::bigint
       from public.request_responses rr
       join public.blood_requests br on br.id = rr.request_id
      where rr.status = 'donated'),
    (select count(*) from public.support_messages where status in ('open', 'in_progress'));
end;
$$;

revoke all on function public.get_admin_dashboard_stats() from public;
grant execute on function public.get_admin_dashboard_stats() to authenticated;

create or replace function public.record_admin_audit(
  action_input text,
  target_type_input text default null,
  target_id_input uuid default null,
  old_values_input jsonb default null,
  new_values_input jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_id uuid;
begin
  if not public.user_has_role('Admin') then
    raise exception 'Admin access required';
  end if;

  insert into public.admin_audit_logs (
    admin_user_id, action, target_type, target_id, old_values, new_values
  ) values (
    auth.uid(), action_input, target_type_input, target_id_input,
    old_values_input, new_values_input
  )
  returning id into audit_id;

  return audit_id;
end;
$$;

revoke all on function public.record_admin_audit(text, text, uuid, jsonb, jsonb) from public;
grant execute on function public.record_admin_audit(text, text, uuid, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
