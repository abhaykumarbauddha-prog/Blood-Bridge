-- Migration: support 'rejected' status in support_messages and admin_set_report_status
alter table if exists public.support_messages 
  drop constraint if exists support_messages_status_check;

alter table if exists public.support_messages 
  add constraint support_messages_status_check 
  check (status in ('open', 'in_progress', 'resolved', 'rejected'));

create or replace function public.admin_set_report_status(report_id_input uuid, status_input text)
returns void
language plpgsql security definer set search_path = public as $$
declare old_status text;
begin
  perform public.require_admin();
  if lower(status_input) not in ('open', 'in_progress', 'resolved', 'rejected') then
    raise exception 'Invalid report status';
  end if;
  select status into old_status from public.support_messages where id = report_id_input for update;
  if not found then raise exception 'Report not found'; end if;
  update public.support_messages set status = lower(status_input) where id = report_id_input;
  perform public.record_admin_audit('support_report_status_changed', 'support_message', report_id_input,
    jsonb_build_object('status', old_status), jsonb_build_object('status', lower(status_input)));
end;
$$;
