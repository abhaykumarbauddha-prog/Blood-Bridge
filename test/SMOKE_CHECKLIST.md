# Blood Bridge Phase 8 Smoke Test Checklist

Use the app from the single configured origin: `http://127.0.0.1:3000`.
Run the Supabase migrations in order before testing database-backed flows.

## 1. Authentication

- [ ] Open `/auth.html` and create a test Donor account with a unique email.
- [ ] Confirm signup handles email verification/session state honestly.
- [ ] Log in with valid credentials and confirm the user dashboard opens.
- [ ] Try an invalid password and confirm login fails without exposing sensitive data.
- [ ] Open Forgot password, submit the account email, open the received link, set a new password, and log in with it.
- [ ] Click Google login after enabling Google in Supabase Authentication providers.
- [ ] Confirm Terms of Service and Privacy Policy links open real pages.

## 2. Blood request lifecycle

- [ ] As a Requester, create a request with a future `required_by` value.
- [ ] Try the same requester, patient, blood group, and hospital again within six hours; confirm duplicate rejection.
- [ ] Try a past `required_by` value; confirm client/server validation rejects it.
- [ ] As a compatible Donor outside the 90-day window, accept the request.
- [ ] As an incompatible Donor or a Donor inside the 90-day window, confirm acceptance is blocked.
- [ ] As the requester or owning Hospital, mark the accepted response as donated.
- [ ] Confirm the response becomes `donated`, the request becomes `fulfilled`, and the donor's `last_donation_date` updates.
- [ ] Confirm expired requests are excluded from dashboard, nearby-request, and find-donors lists.

## 3. Notifications

- [ ] Trigger a matching request and confirm a notification is created for the compatible donor within 100 km.
- [ ] Accept a request and confirm the requester receives an acceptance notification.
- [ ] Mark a response donated and confirm donation/badge notifications where applicable.
- [ ] Open `/notifications.html`; test All, Unread, Requests, and System tabs.
- [ ] Mark one notification as read, then use Mark all as read.
- [ ] Confirm sidebar/topbar unread badges disappear at zero.
- [ ] Open an action link and confirm it navigates to a real page.
- [ ] Open two notification tabs and confirm a new notification appears through Realtime.

## 4. Role-based access and RLS

- [ ] Log in as a normal Donor and open `/admin-dashboard.html`; confirm the UX guard redirects away.
- [ ] While still a normal Donor, use the browser console to query an admin-only table/action; confirm Supabase RLS rejects unauthorized data access.
- [ ] Log in as a Hospital and confirm `/hospital-dashboard.html` opens while `/admin-dashboard.html` is blocked.
- [ ] Log in as an Admin and confirm admin dashboard data loads.
- [ ] Confirm users cannot change their own `role` through the browser client.

## 5. Profile, location, maps, and inventory

- [ ] Update name, phone, blood group, availability, location, and profile photo in `/my-profile.html`.
- [ ] Refresh dashboard and confirm the same name, role, location, and image appear everywhere.
- [ ] Remove the profile photo and confirm the UI returns to the honest default image.
- [ ] Leave location unset and confirm maps show “Location not set” instead of fallback coordinates.
- [ ] Confirm donor/request maps use the same 100 km radius and clustered markers.
- [ ] As a Hospital, open `/hospital-dashboard.html`, save each inventory group, refresh, and confirm values persist in `blood_inventory`.

## 6. Donation history, settings, and support

- [ ] Open `/donation-history.html`; confirm only `donated` responses appear.
- [ ] Test search, This Year, Last Year, All Time, and CSV export.
- [ ] Confirm Next Eligible Date equals last donation plus 90 days.
- [ ] Open `/settings.html`; switch every tab and confirm only the selected section is shown.
- [ ] Change notification/privacy/donation preferences, refresh, and confirm values persist in `user_settings`.
- [ ] Change password using the wrong current password; confirm rejection.
- [ ] Change password using the correct current password; confirm success.
- [ ] Open `/help-support.html`; expand every FAQ item and search for a question.
- [ ] Submit a support message and confirm it is saved in `support_messages` with success feedback.

## 7. Homepage and basic regression

- [ ] Open `/index.html`; confirm homepage stats are live or show `-` when no data exists.
- [ ] Click every homepage navbar link and confirm it reaches a real section/page.
- [ ] Confirm no fake names, counts, notifications, placeholder images, or `href="#"` actions remain in the tested flow.
- [ ] Test at desktop and mobile widths; confirm no primary control is unreachable or clipped.

## Required evidence

- Record the test account roles and test request IDs.
- Capture Supabase rows for the request, response, notification, support message, and user settings checks.
- Record any failed step with browser console output and the Supabase error message.
