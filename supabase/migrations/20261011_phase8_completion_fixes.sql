-- Completion fixes discovered during the Phase 0-8 audit.
-- Run after phases 2-7. This migration only adds a safe aggregate RPC.

create or replace function public.get_public_platform_stats()
returns table (
    active_donors bigint,
    verified_hospitals bigint,
    fulfilled_donations bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        (select count(*) from public.users where is_donor = true and is_available = true),
        (select count(*) from public.users where role = 'Hospital' and verification_status = 'verified'),
        (select count(*) from public.request_responses where status = 'donated');
$$;

revoke all on function public.get_public_platform_stats() from public;
grant execute on function public.get_public_platform_stats() to anon, authenticated;

create or replace function public.get_request_contact(request_id_input uuid)
returns table (
    requester_phone text,
    requester_email text,
    donor_phone text,
    donor_email text,
    hospital_name text,
    hospital_address text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    request_row public.blood_requests;
    response_row public.request_responses;
begin
    select * into request_row
    from public.blood_requests
    where id = request_id_input;

    select * into response_row
    from public.request_responses
    where request_id = request_id_input
      and status in ('accepted', 'donated')
    order by created_at desc
    limit 1;

    if request_row.id is null or response_row.id is null then
        raise exception 'Contact details are available only after acceptance.' using errcode = 'P0001';
    end if;

    if auth.uid() <> request_row.requester_id
       and auth.uid() <> response_row.donor_id
       and not public.user_has_role('Admin')
       and not (
           public.user_has_role('Hospital')
           and exists (
               select 1 from public.users hospital_user
               where hospital_user.id = auth.uid()
                 and hospital_user.full_name = request_row.hospital_name
           )
       ) then
        raise exception 'You are not allowed to view these contact details.' using errcode = 'P0001';
    end if;

    return query
    select requester.phone,
           requester_auth.email::text,
           donor.phone,
           donor_auth.email::text,
           request_row.hospital_name,
           request_row.hospital_address
    from public.users requester
    left join auth.users requester_auth on requester_auth.id = requester.id
    left join public.users donor on donor.id = response_row.donor_id
    left join auth.users donor_auth on donor_auth.id = donor.id
    where requester.id = request_row.requester_id;
end;
$$;

revoke all on function public.get_request_contact(uuid) from public;
grant execute on function public.get_request_contact(uuid) to authenticated;

insert into storage.buckets (id, name, public)
values ('userprofilephotos', 'userprofilephotos', true)
on conflict (id) do update set public = true;

drop policy if exists "Anyone can view profile photos" on storage.objects;
create policy "Anyone can view profile photos"
on storage.objects for select
using (bucket_id = 'userprofilephotos');

drop policy if exists "Users can upload their profile photos" on storage.objects;
create policy "Users can upload their profile photos"
on storage.objects for insert to authenticated
with check (
    bucket_id = 'userprofilephotos'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their profile photos" on storage.objects;
create policy "Users can update their profile photos"
on storage.objects for update to authenticated
using (
    bucket_id = 'userprofilephotos'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'userprofilephotos'
    and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their profile photos" on storage.objects;
create policy "Users can delete their profile photos"
on storage.objects for delete to authenticated
using (
    bucket_id = 'userprofilephotos'
    and (storage.foldername(name))[1] = auth.uid()::text
);

notify pgrst, 'reload schema';
