// frontend/js/supabase.js

// The anon key is safe to use in browser code. Never expose the service-role key.
const SUPABASE_URL = 'https://esxikytmtakzmzfjomie.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzeGlreXRtdGFrem16ZmpvbWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NDQzODUsImV4cCI6MjEwNzIyMDM4NX0.iyFw_1h8evbN4yhYcahp0_pS0GRJiShZVutkc4iH-Uo';

// Keep the client separate from window.supabase, which is the CDN namespace.
if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase CDN failed to load. Check your internet connection and try again.');
}

window.bloodBridgeSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
