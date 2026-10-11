// backend/config/supabaseClient.js
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error(
        'Missing SUPABASE_URL or SUPABASE_ANON_KEY. Add both variables to the project .env file.'
    );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Forward a signed-in user's JWT so Supabase RLS evaluates the real user.
supabase.forRequest = (req) => {
    const authorization = req.get?.('authorization') || req.headers?.authorization;
    if (!authorization) return supabase;

    return createClient(supabaseUrl, supabaseKey, {
        global: { headers: { Authorization: authorization } }
    });
};

module.exports = supabase;
