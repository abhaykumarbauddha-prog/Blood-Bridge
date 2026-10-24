-- ============================================================
-- BLOOD BRIDGE: SMART MATCHING, NOTIFICATIONS & DONATION FIX
-- Supabase Dashboard > SQL Editor mein paste karke RUN karein
-- ============================================================

-- 1. RLS POLICIES FOR NOTIFICATIONS
drop policy if exists "Anyone authenticated can insert notifications" on public.notifications;
create policy "Anyone authenticated can insert notifications"
  on public.notifications for insert to authenticated
  with check (true);

drop policy if exists "Anon can insert notifications" on public.notifications;
create policy "Anon can insert notifications"
  on public.notifications for insert to anon
  with check (true);

-- 2. RLS POLICIES FOR REQUEST_RESPONSES
drop policy if exists "Users update own responses" on public.request_responses;
create policy "Users update own responses"
  on public.request_responses for update to authenticated
  using (
    donor_id = auth.uid()
    or exists (
      select 1 from public.blood_requests br
      where br.id = request_responses.request_id and br.requester_id = auth.uid()
    )
  );

drop policy if exists "Donors create responses" on public.request_responses;
create policy "Donors create responses"
  on public.request_responses for insert to authenticated
  with check (donor_id = auth.uid());

-- 3. RLS POLICIES FOR BLOOD_REQUESTS
drop policy if exists "Donors can update accepted requests" on public.blood_requests;
create policy "Donors can update accepted requests"
  on public.blood_requests for update to authenticated
  using (
    requester_id = auth.uid()
    or exists (
      select 1 from public.request_responses rr
      where rr.request_id = blood_requests.id and rr.donor_id = auth.uid()
    )
    or status = 'open'
  );

-- 4. SMART MATCHING TRIGGER FUNCTION
create or replace function public.notify_matching_donors_on_request()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  donor_record record;
  donor_count int := 0;
begin
  for donor_record in
    select u.id, u.full_name, u.city
    from public.users u
    where u.id <> new.requester_id
      and (u.is_donor = true or u.role = 'Donor')
      and (u.is_available = true or lower(coalesce(u.availability_status, '')) = 'available')
      and public.blood_group_compatible(u.blood_group, new.blood_group)
  loop
    insert into public.notifications (user_id, type, title, body, link)
    values (
      donor_record.id,
      'request',
      'Urgent Blood Match: ' || new.blood_group || ' Needed! 🩸',
      'Patient ' || new.patient_name || ' urgently needs ' || new.units || ' unit(s) of ' || new.blood_group || ' at ' || new.hospital_name || ', ' || new.city || '. Your profile is a compatible match!',
      'nearby-request.html'
    );
    donor_count := donor_count + 1;
  end loop;

  -- Confirm to requester
  insert into public.notifications (user_id, type, title, body, link)
  values (
    new.requester_id,
    'system',
    'Blood Request Broadcasted! 📢',
    'Your request for ' || new.patient_name || ' (' || new.units || ' units of ' || new.blood_group || ') has been broadcasted to compatible donors.',
    'nearby-request.html'
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_matching_donors on public.blood_requests;
create trigger trg_notify_matching_donors
  after insert on public.blood_requests
  for each row execute function public.notify_matching_donors_on_request();

-- 5. FUNCTION TO ACCEPT REQUEST (Security Definer)
create or replace function public.accept_blood_request(request_id_input uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  req_row record;
  donor_name text;
  donor_phone text;
  caller_id uuid;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  select * into req_row from public.blood_requests where id = request_id_input;
  if not found then
    raise exception 'Request not found';
  end if;

  select coalesce(full_name, 'A verified donor'), coalesce(phone, '')
  into donor_name, donor_phone
  from public.users where id = caller_id;

  -- Upsert response
  insert into public.request_responses (request_id, donor_id, status)
  values (request_id_input, caller_id, 'accepted')
  on conflict (request_id, donor_id) do update set status = 'accepted';

  -- Update request status
  update public.blood_requests set status = 'matched' where id = request_id_input;

  -- Notify Requester
  insert into public.notifications (user_id, type, title, body, link)
  values (
    req_row.requester_id,
    'response',
    'Donor Accepted Your Request! ❤️',
    'Good news! Donor ' || donor_name || ' has accepted your blood request for ' || req_row.patient_name || ' at ' || req_row.hospital_name || '. Contact: ' || donor_phone,
    'nearby-request.html'
  );

  -- Notify Donor
  insert into public.notifications (user_id, type, title, body, link)
  values (
    caller_id,
    'response',
    'Donation Pledge Saved: ' || req_row.patient_name || ' 🩸',
    'You accepted to donate for ' || req_row.patient_name || ' at ' || req_row.hospital_name || ', ' || req_row.city || '. View in Donation History.',
    'donation-history.html'
  );

  return json_build_object('success', true, 'message', 'Request accepted successfully');
end;
$$;

grant execute on function public.accept_blood_request(uuid) to authenticated;

-- 6. FUNCTION TO MARK DONATION COMPLETE (Security Definer)
create or replace function public.mark_donation_completed(request_id_input uuid, donor_id_input uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  req_row record;
  actual_donor_id uuid;
  donor_name text;
  requester_name text;
  donation_time timestamptz := now();
begin
  select * into req_row from public.blood_requests where id = request_id_input;
  if not found then
    raise exception 'Request not found';
  end if;

  if donor_id_input is not null then
    actual_donor_id := donor_id_input;
  else
    select donor_id into actual_donor_id from public.request_responses
    where request_id = request_id_input order by created_at desc limit 1;
  end if;

  if actual_donor_id is null then
    raise exception 'No donor found for this request';
  end if;

  -- Update response
  update public.request_responses
  set status = 'donated', donated_at = donation_time
  where request_id = request_id_input and donor_id = actual_donor_id;

  -- Update blood_request
  update public.blood_requests set status = 'fulfilled' where id = request_id_input;

  -- Update donor last donation date
  update public.users set last_donation_date = current_date where id = actual_donor_id;

  select coalesce(full_name, 'Donor') into donor_name from public.users where id = actual_donor_id;
  select coalesce(full_name, 'Requester') into requester_name from public.users where id = req_row.requester_id;

  -- Notify Donor
  insert into public.notifications (user_id, type, title, body, link)
  values (
    actual_donor_id,
    'badge_earned',
    'Blood Donation Successful! 🏆',
    'Thank you, ' || donor_name || '! Your blood donation for patient ' || req_row.patient_name || ' (Requested by ' || requester_name || ') has been verified and recorded.',
    'donation-history.html'
  );

  -- Notify Requester
  insert into public.notifications (user_id, type, title, body, link)
  values (
    req_row.requester_id,
    'system',
    'Donation Completed! 🎉',
    'The blood donation for patient ' || req_row.patient_name || ' by donor ' || donor_name || ' has been completed. Thank you!',
    'nearby-request.html'
  );

  return json_build_object('success', true, 'message', 'Donation marked as completed');
end;
$$;

grant execute on function public.mark_donation_completed(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
