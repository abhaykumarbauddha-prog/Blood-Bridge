// frontend/js/auth.js

document.addEventListener('DOMContentLoaded', () => {
    const supabaseClient = window.bloodBridgeSupabase;
    if (!supabaseClient?.auth) {
        alert('Authentication service is unavailable. Please refresh the page.');
        return;
    }

    const signupForm = document.querySelector('#signup-view form');
    const loginForm = document.querySelector('#login-view form');
    let selectedRole = 'Donor'; 

    // Role select karne ka logic
    document.querySelectorAll('.role-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Button ka color change karne ke liye
            document.querySelectorAll('.role-btn').forEach(b => {
                b.style.background = 'white';
                b.style.color = '#E60023';
            });
            e.target.style.background = '#E60023';
            e.target.style.color = 'white';
            
            selectedRole = e.target.textContent.replace(/[^a-zA-Z]/g, '').trim(); 
        });
    });

    // SIGN UP LOGIC
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const inputs = signupForm.querySelectorAll('.form-control');
            const fullName = inputs[0].value;
            const email = inputs[1].value;
            const phone = inputs[2].value;
            const password = inputs[3].value;
            const confirmPassword = inputs[4].value;

            if (password !== confirmPassword) {
                return alert("Passwords match nahi ho rahe!");
            }

            try {
                // 1. Supabase Auth mein user banayein
                const { data, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: fullName,
                            phone,
                            role: selectedRole
                        }
                    }
                });
                if (error) throw error;

                if (data.user) {
                    const message = data.session
                        ? 'Account successfully created. You can continue now.'
                        : 'Account created. Please verify your email before logging in.';
                    alert(message);
                    window.location.reload();
                }
            } catch (error) {
                const message = error?.message || '';
                if (/rate limit|too many requests|email rate/i.test(message)) {
                    alert('Email limit exceed ho gayi hai. Agar account pehle ban chuka hai to Login try karo, warna kuch der baad Sign Up dobara karo.');
                } else {
                    alert("Signup error: " + message);
                }
            }
        });
    }

    // LOGIN LOGIC
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const inputs = loginForm.querySelectorAll('.form-control');
            const email = inputs[0].value;
            const password = inputs[1].value;

            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;

                if (data.session) {
                    // User ka role check karein
                    const { data: userData, error: userError } = await supabaseClient
                        .from('users')
                        .select('role')
                        .eq('id', data.user.id)
                        .maybeSingle();

                    if (userError) throw userError;

                    // Older accounts may exist in Auth without a public.users profile.
                    // Create a safe default profile so login does not fail for them.
                    if (!userData) {
                        const metadata = data.user.user_metadata || {};
                        const allowedRoles = ['Donor', 'Requester', 'Hospital'];
                        const role = allowedRoles.includes(metadata.role) ? metadata.role : 'Donor';
                        const { error: profileError } = await supabaseClient.from('users').insert({
                            id: data.user.id,
                            full_name: metadata.full_name || data.user.email?.split('@')[0] || 'User',
                            phone: metadata.phone || '',
                            role
                        });

                        // Do not block login if the profile already exists due to a race.
                        if (profileError && !/duplicate|already exists/i.test(profileError.message || '')) {
                            console.warn('Profile creation skipped:', profileError.message);
                        }
                    }

                    alert("Login Successful!");
                    
                    // Role ke hisaab se dashboard par bhejein
                    const role = userData?.role || data.user.user_metadata?.role || 'Donor';
                    if (role === 'Hospital') {
                        window.location.href = 'hospital-dashboard.html';
                    } else if (role === 'Admin') {
                        window.location.href = 'admin-dashboard.html';
                    } else {
                        window.location.href = 'user-dashboard.html';
                    }
                }
            } catch (error) {
                const message = error?.message || '';
                if (/rate limit|too many requests|email rate/i.test(message)) {
                    alert('Supabase email limit temporarily exceed ho gayi hai. Kuch der baad try karo.');
                } else {
                    alert("Login fail ho gaya: " + message);
                }
            }
        });
    }
});
