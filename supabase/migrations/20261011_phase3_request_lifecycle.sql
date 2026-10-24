-- Phase 3 request lifecycle. Idempotent and non-destructive.

alter table public.blood_requests add column if not exists required_by timestamptz;

update public.blood_requests
set required_by = ((required_date + required_time) at time zone 'Asia/Kolkata')
where required_by is null and required_date is not null and required_time is not null;

update public.blood_requests
set status = case
  when lower(status) = 'fulfilled' then 'fulfilled'
  when lower(status) in ('cancelled', 'expired', 'matched', 'open') then lower(status)
  else 'open'
end;

alter table public.blood_requests alter column status set default 'open';
alter table public.blood_requests alter column required_by set not null;
alter table public.blood_requests drop constraint if exists blood_requests_status_check;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'blood_requests_status_allowed'
      and conrelid = 'public.blood_requests'::regclass
  ) then
    alter table public.blood_requests
      add constraint blood_requests_status_allowed
      check (status in ('open', 'matched', 'fulfilled', 'expired', 'cancelled'));
  end if;
end $$;

create or replace function public.validate_blood_request_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.required_by <= timezone('utc', now()) then
    raise exception 'required_by must be in the future.' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' and exists (
    select 1 from public.blood_requests br
    where br.requester_id = new.requester_id
      and br.patient_name = new.patient_name
      and br.blood_group = new.blood_group
      and br.hospital_name = new.hospital_name
      and br.created_at >= timezone('utc', now()) - interval '6 hours'
  ) then
    raise exception 'A similar request was already created within the last 6 hours.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists blood_request_lifecycle_validation on public.blood_requests;
create trigger blood_request_lifecycle_validation
before insert or update of required_by, requester_id, patient_name, blood_group, hospital_name
on public.blood_requests
for each row execute function public.validate_blood_request_lifecycle();

create or replace function public.expire_open_blood_requests()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare expired_count integer;
begin
  update public.blood_requests
  set status = 'expired'
  where status = 'open' and required_by <= timezone('utc', now());
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

revoke all on function public.expire_open_blood_requests() from public;
grant execute on function public.expire_open_blood_requests() to authenticated;

create table if not exists public.request_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.blood_requests(id) on delete cascade,
  donor_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted', 'donated', 'declined', 'no_show')),
  donated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  unique (request_id, donor_id)
);

alter table public.request_responses enable row level security;
drop policy if exists "Users can read relevant request responses" on public.request_responses;
create policy "Users can read relevant request responses"
  on public.request_responses for select to authenticated
  using (
    donor_id = auth.uid()
    or exists (
      select 1 from public.blood_requests br
      where br.id = request_responses.request_id
        and (br.requester_id = auth.uid() or public.user_has_role('Admin'))
    )
    or (
      public.user_has_role('Hospital')
      and exists (
        select 1 from public.blood_requests br
        join public.users u on u.full_name = br.hospital_name
        where br.id = request_responses.request_id and u.id = auth.uid()
      )
    )
  );

drop policy if exists "Donors can create accepted responses" on public.request_responses;
create policy "Donors can create accepted responses"
  on public.request_responses for insert to authenticated
  with check (donor_id = auth.uid() and status = 'accepted');

drop policy if exists "Relevant users can update responses" on public.request_responses;
create policy "Relevant users can update responses"
  on public.request_responses for update to authenticated
  using (
    donor_id = auth.uid()
    or exists (
      select 1 from public.blood_requests br
      where br.id = request_responses.request_id
        and (br.requester_id = auth.uid() or public.user_has_role('Admin'))
    )
  )
  with check (donor_id = auth.uid() or public.user_has_role('Admin'));

create or replace function public.blood_group_compatible(donor_group text, recipient_group text)
returns boolean
language sql immutable
as $$
  select case donor_group
    when 'O-' then recipient_group in ('O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+')
    when 'O+' then recipient_group in ('O+', 'A+', 'B+', 'AB+')
    when 'A-' then recipient_group in ('A-', 'A+', 'AB-', 'AB+')
    when 'A+' then recipient_group in ('A+', 'AB+')
    when 'B-' then recipient_group in ('B-', 'B+', 'AB-', 'AB+')
    when 'B+' then recipient_group in ('B+', 'AB+')
    when 'AB-' then recipient_group in ('AB-', 'AB+')
    when 'AB+' then recipient_group = 'AB+'
    else false
  end;
$$;

create or replace function public.accept_blood_request(request_id_input uuid)
returns public.request_responses
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.blood_requests;
  donor_row public.users;
  response_row public.request_responses;
begin
  select * into request_row from public.blood_requests where id = request_id_input;
  if not found or request_row.status <> 'open' or request_row.required_by <= now() then
    raise exception 'This blood request is no longer open.' using errcode = 'P0001';
  end if;

  select * into donor_row from public.users where id = auth.uid();
  if not found or donor_row.role <> 'Donor' then
    raise exception 'Only donor accounts can accept a request.' using errcode = 'P0001';
  end if;
  if donor_row.last_donation_date is not null and donor_row.last_donation_date > (current_date - 90) then
    raise exception 'You are within the 90-day donation waiting period.' using errcode = 'P0001';
  end if;
  if not public.blood_group_compatible(donor_row.blood_group, request_row.blood_group) then
    raise exception 'Your blood group is not compatible with this request.' using errcode = 'P0001';
  end if;

  insert into public.request_responses (request_id, donor_id, status)
  values (request_id_input, auth.uid(), 'accepted')
  returning * into response_row;
  update public.blood_requests set status = 'matched' where id = request_id_input and status = 'open';
  return response_row;
exception when unique_violation then
  raise exception 'You have already responded to this request.' using errcode = 'P0001';
end;
$$;

create or replace function public.mark_response_donated(response_id_input uuid)
returns public.request_responses
language plpgsql
security definer
set search_path = public
as $$
declare
  response_row public.request_responses;
  request_row public.blood_requests;
begin
  select rr.* into response_row from public.request_responses rr where rr.id = response_id_input;
  if not found then raise exception 'Response not found.' using errcode = 'P0001'; end if;
  select br.* into request_row from public.blood_requests br where br.id = response_row.request_id;
  if request_row.requester_id <> auth.uid()
     and not public.user_has_role('Admin')
     and not (public.user_has_role('Hospital') and exists (
       select 1 from public.users u where u.id = auth.uid() and u.full_name = request_row.hospital_name
     )) then
    raise exception 'You are not allowed to verify this donation.' using errcode = 'P0001';
  end if;
  if response_row.status <> 'accepted' then
    raise exception 'Only an accepted response can be marked donated.' using errcode = 'P0001';
  end if;

  update public.request_responses
  set status = 'donated', donated_at = timezone('utc', now())
  where id = response_id_input
  returning * into response_row;
  update public.users set last_donation_date = current_date where id = response_row.donor_id;
  update public.blood_requests set status = 'fulfilled' where id = response_row.request_id;
  return response_row;
end;
$$;

revoke all on function public.accept_blood_request(uuid) from public;
grant execute on function public.accept_blood_request(uuid) to authenticated;
revoke all on function public.mark_response_donated(uuid) from public;
grant execute on function public.mark_response_donated(uuid) to authenticated;

notify pgrst, 'reload schema';
