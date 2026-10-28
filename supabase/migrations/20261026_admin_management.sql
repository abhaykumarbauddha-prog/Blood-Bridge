-- Admin-only management queries and actions.
-- All functions reject callers without user_roles.role = 'Admin'.

alter table public.users
  add column if not exists account_status text not null default 'active';

-- PostgreSQL cannot replace a function when its OUT/RETURNS TABLE columns
-- change. These drops make this migration safe to rerun after a partial run.
drop function if exists public.admin_list_users(text, text);
drop function if exists public.admin_list_requests(text, text);
drop function if exists public.admin_list_hospitals(text);
drop function if exists public.admin_list_donations(text);
drop function if exists public.admin_list_reports(text);
drop function if exists public.admin_list_audit_logs();
drop function if exists public.admin_list_notifications();
drop function if exists public.admin_system_status();
drop function if exists public.admin_set_hospital_verification(uuid, text);
drop function if exists public.admin_set_request_status(uuid, text);
drop function if exists public.admin_set_report_status(uuid, text);
drop function if exists public.require_admin();

create or replace function public.require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.user_has_role('Admin') then
    raise exception 'Admin access required';
  end if;
end;
$$;

revoke all on function public.require_admin() from public;
grant execute on function public.require_admin() to authenticated;

create or replace function public.admin_list_users(
  role_filter text default null,
  search_text text default null
)
returns table (
  id uuid, full_name text, phone text, role text, blood_group text,
  city text, is_available boolean, verification_status text, account_status text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select u.id, u.full_name, u.phone, u.role, u.blood_group, u.city,
         u.is_available, u.verification_status, coalesce(u.account_status, 'active'), u.created_at
    from public.users u
   where (role_filter is null or lower(u.role) = lower(role_filter))
     and (search_text is null or search_text = '' or
          lower(concat_ws(' ', u.full_name, u.phone, u.city, u.blood_group, u.role)) like '%' || lower(search_text) || '%')
   order by u.created_at desc;
end;
$$;

create or replace function public.admin_list_requests(
  status_filter text default null,
  search_text text default null
)
returns table (
  id uuid, patient_name text, blood_group text, units integer, urgency text,
  hospital_name text, city text, status text, required_by timestamptz,
  requester_id uuid, created_at timestamptz, response_count bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select br.id, br.patient_name, br.blood_group, br.units, br.urgency,
         br.hospital_name, br.city, br.status, br.required_by, br.requester_id,
         br.created_at,
         (select count(*) from public.request_responses rr where rr.request_id = br.id)
    from public.blood_requests br
   where (status_filter is null or lower(coalesce(br.status, '')) = lower(status_filter))
     and (search_text is null or search_text = '' or
          lower(concat_ws(' ', br.patient_name, br.blood_group, br.hospital_name, br.city, br.urgency)) like '%' || lower(search_text) || '%')
   order by br.created_at desc;
end;
$$;

create or replace function public.admin_list_hospitals(search_text text default null)
returns table (
  id uuid, full_name text, phone text, city text, state text, hospital_type text,
  verification_status text, website text, created_at timestamptz, inventory_units bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select u.id, u.full_name, u.phone, u.city, u.state, u.hospital_type,
         coalesce(u.verification_status, 'pending'), u.website, u.created_at,
         coalesce((select sum(bi.units)::bigint from public.blood_inventory bi where bi.hospital_id = u.id), 0)
    from public.users u
   where u.role = 'Hospital'
     and (search_text is null or search_text = '' or
          lower(concat_ws(' ', u.full_name, u.phone, u.city, u.state, u.hospital_type)) like '%' || lower(search_text) || '%')
   order by u.created_at desc;
end;
$$;

create or replace function public.admin_list_donations(search_text text default null)
returns table (
  response_id uuid, request_id uuid, donor_id uuid, donor_name text,
  blood_group text, hospital_name text, units integer, status text,
  donated_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select rr.id, br.id, rr.donor_id, u.full_name, u.blood_group,
         br.hospital_name, br.units, rr.status, rr.donated_at, rr.created_at
    from public.request_responses rr
    join public.blood_requests br on br.id = rr.request_id
    left join public.users u on u.id = rr.donor_id
   where (search_text is null or search_text = '' or
          lower(concat_ws(' ', u.full_name, u.blood_group, br.hospital_name, rr.status)) like '%' || lower(search_text) || '%')
   order by rr.created_at desc;
end;
$$;

create or replace function public.admin_list_reports(status_filter text default null)
returns table (
  id uuid, user_id uuid, email text, subject text, message text,
  status text, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select sm.id, sm.user_id, sm.email, sm.subject, sm.message, sm.status, sm.created_at
    from public.support_messages sm
   where (status_filter is null or lower(sm.status) = lower(status_filter))
   order by sm.created_at desc;
end;
$$;

create or replace function public.admin_list_audit_logs()
returns table (
  id uuid, admin_user_id uuid, admin_name text, action text,
  target_type text, target_id uuid, old_values jsonb, new_values jsonb,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select al.id, al.admin_user_id, u.full_name, al.action, al.target_type,
         al.target_id, al.old_values, al.new_values, al.created_at
    from public.admin_audit_logs al
    left join public.users u on u.id = al.admin_user_id
   order by al.created_at desc
   limit 500;
end;
$$;

create or replace function public.admin_list_notifications()
returns table (
  id uuid, user_id uuid, user_name text, type text, title text,
  body text, read_at timestamptz, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select n.id, n.user_id, u.full_name, n.type, n.title, n.body, n.read_at, n.created_at
    from public.notifications n
    left join public.users u on u.id = n.user_id
   order by n.created_at desc
   limit 500;
end;
$$;

create or replace function public.admin_system_status()
returns table (
  database_status text, authenticated_users bigint, open_requests bigint,
  unread_notifications bigint, last_activity timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_admin();
  return query
  select 'operational'::text,
         (select count(*) from public.users),
         (select count(*) from public.blood_requests where lower(coalesce(status, '')) in ('open', 'pending', 'urgent', 'critical', 'matched')),
         (select count(*) from public.notifications where read_at is null),
         greatest(
           (select max(created_at) from public.users),
           (select max(created_at) from public.blood_requests),
           (select max(created_at) from public.notifications)
         );
end;
$$;

create or replace function public.admin_set_hospital_verification(hospital_id_input uuid, status_input text)
returns void
language plpgsql security definer set search_path = public as $$
declare old_status text;
begin
  perform public.require_admin();
  if lower(status_input) not in ('pending', 'verified', 'rejected', 'suspended') then
    raise exception 'Invalid hospital verification status';
  end if;
  select verification_status into old_status from public.users
   where id = hospital_id_input and role = 'Hospital' for update;
  if not found then raise exception 'Hospital not found'; end if;
  update public.users set verification_status = lower(status_input) where id = hospital_id_input;
  perform public.record_admin_audit('hospital_verification_changed', 'hospital', hospital_id_input,
    jsonb_build_object('verification_status', old_status),
    jsonb_build_object('verification_status', lower(status_input)));
end;
$$;

create or replace function public.admin_set_request_status(request_id_input uuid, status_input text)
returns void
language plpgsql security definer set search_path = public as $$
declare old_status text;
begin
  perform public.require_admin();
  if lower(status_input) not in ('open', 'matched', 'fulfilled', 'expired', 'cancelled') then
    raise exception 'Invalid request status';
  end if;
  select status into old_status from public.blood_requests where id = request_id_input for update;
  if not found then raise exception 'Request not found'; end if;
  update public.blood_requests set status = lower(status_input) where id = request_id_input;
  perform public.record_admin_audit('request_status_changed', 'blood_request', request_id_input,
    jsonb_build_object('status', old_status), jsonb_build_object('status', lower(status_input)));
end;
$$;

create or replace function public.admin_set_report_status(report_id_input uuid, status_input text)
returns void
language plpgsql security definer set search_path = public as $$
declare old_status text;
begin
  perform public.require_admin();
  if lower(status_input) not in ('open', 'in_progress', 'resolved') then
    raise exception 'Invalid report status';
  end if;
  select status into old_status from public.support_messages where id = report_id_input for update;
  if not found then raise exception 'Report not found'; end if;
  update public.support_messages set status = lower(status_input) where id = report_id_input;
  perform public.record_admin_audit('support_report_status_changed', 'support_message', report_id_input,
    jsonb_build_object('status', old_status), jsonb_build_object('status', lower(status_input)));
end;
$$;

revoke all on function public.admin_list_users(text, text) from public;
revoke all on function public.admin_list_requests(text, text) from public;
revoke all on function public.admin_list_hospitals(text) from public;
revoke all on function public.admin_list_donations(text) from public;
revoke all on function public.admin_list_reports(text) from public;
revoke all on function public.admin_list_audit_logs() from public;
revoke all on function public.admin_list_notifications() from public;
revoke all on function public.admin_system_status() from public;
revoke all on function public.admin_set_hospital_verification(uuid, text) from public;
revoke all on function public.admin_set_request_status(uuid, text) from public;
revoke all on function public.admin_set_report_status(uuid, text) from public;

grant execute on function public.admin_list_users(text, text) to authenticated;
grant execute on function public.admin_list_requests(text, text) to authenticated;
grant execute on function public.admin_list_hospitals(text) to authenticated;
grant execute on function public.admin_list_donations(text) to authenticated;
grant execute on function public.admin_list_reports(text) to authenticated;
grant execute on function public.admin_list_audit_logs() to authenticated;
grant execute on function public.admin_list_notifications() to authenticated;
grant execute on function public.admin_system_status() to authenticated;
grant execute on function public.admin_set_hospital_verification(uuid, text) to authenticated;
grant execute on function public.admin_set_request_status(uuid, text) to authenticated;
grant execute on function public.admin_set_report_status(uuid, text) to authenticated;

notify pgrst, 'reload schema';
