// frontend/js/auth.js
// Handles real Supabase Signup, Login, Profile saving & fetching

document.addEventListener('DOMContentLoaded', () => {
    const supabaseClient = window.bloodBridgeSupabase;
    if (!supabaseClient?.auth) {
        alert('Authentication service is unavailable. Please check your connection and refresh the page.');
        return;
    }

    const signupForm = document.querySelector('#signup-view form');
    const loginForm = document.querySelector('#login-view form');
    let selectedRole = 'Donor';

    // Forgot password link navigation
    document.querySelector('[data-forgot-password]')?.addEventListener('click', (event) => {
        event.preventDefault();
        window.location.href = 'reset-password.html';
    });

    // Role selector logic
    const roleButtons = document.querySelectorAll('.role-btn');
    roleButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            roleButtons.forEach(b => {
                b.classList.remove('active');
                b.style.background = '';
                b.style.color = '';
            });
            const clickedBtn = e.currentTarget;
            clickedBtn.classList.add('active');
            const dataRole = clickedBtn.getAttribute('data-role');
            if (dataRole) {
                selectedRole = dataRole;
            } else {
                selectedRole = clickedBtn.textContent.replace(/[^a-zA-Z]/g, '').trim() || 'Donor';
            }
        });
    });

    function navigateToRoleDashboard(role) {
        if (role === 'Hospital') {
            window.location.href = 'hospital-dashboard.html';
        } else if (role === 'Admin') {
            window.location.href = 'admin-dashboard.html';
        } else {
            window.location.href = 'dashboard.html';
        }
    }

    // Demo role session generator (only if explicitly clicked)
    function createMockSession(email, role, name = 'Demo User') {
        const userId = 'd' + Date.now().toString(16) + '000000000000'.slice(0, 12);
        const user = {
            id: userId,
            aud: 'authenticated',
            role: 'authenticated',
            email: email,
            user_metadata: { full_name: name, role: role, phone: '+91 98765 43210' },
            created_at: new Date().toISOString()
        };
        const session = {
            access_token: 'demo-jwt-token-' + Date.now(),
            token_type: 'bearer',
            expires_in: 86400,
            refresh_token: 'demo-refresh-token-' + Date.now(),
            user: user
        };
        localStorage.setItem('blood_bridge_user_role', role);
        localStorage.setItem('blood_bridge_user', JSON.stringify(user));
        return session;
    }

    document.querySelectorAll('[data-demo-role]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const role = e.currentTarget.getAttribute('data-demo-role') || 'Donor';
            createMockSession(`demo.${role.toLowerCase()}@bloodbridge.org`, role, `Demo ${role}`);
            alert(`Welcome! Logged in as ${role}.`);
            navigateToRoleDashboard(role);
        });
    });

    // ==========================================
    // SIGN UP LOGIC (Real Supabase + DB Save)
    // ==========================================
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = signupForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Sign Up →';

            const inputs = signupForm.querySelectorAll('.form-control');
            const fullName = inputs[0]?.value.trim();
            const email = inputs[1]?.value.trim();
            const phone = inputs[2]?.value.trim();
            const password = inputs[3]?.value;
            const confirmPassword = inputs[4]?.value;

            if (!fullName || !email || !phone || !password) {
                alert('Please fill in all required fields.');
                return;
            }

            if (password !== confirmPassword) {
                alert('Passwords match nahi ho rahe! Please make sure both password fields are identical.');
                return;
            }

            if (password.length < 6) {
                alert('Password must be at least 6 characters long.');
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = 'Creating account... ⏳';
            }

            try {
                // 1. Supabase Auth signup
                const { data, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: fullName,
                            phone: phone,
                            role: selectedRole
                        }
                    }
                });

                if (error) {
                    throw error;
                }

                const user = data?.user;
                if (!user) {
                    throw new Error('Unable to create user. Please try again.');
                }

                // 2. Check if user is already logged in (session returned)
                if (data.session) {
                    // Save / upsert into public.users table in database
                    try {
                        await supabaseClient.from('users').upsert({
                            id: user.id,
                            full_name: fullName,
                            phone: phone,
                            role: selectedRole,
                            is_donor: selectedRole === 'Donor',
                            is_available: false
                        }, { onConflict: 'id' });
                    } catch (dbErr) {
                        console.warn('Note: user profile upsert status:', dbErr);
                    }

                    localStorage.setItem('blood_bridge_user_role', selectedRole);
                    localStorage.setItem('blood_bridge_user', JSON.stringify({
                        id: user.id,
                        email: user.email,
                        full_name: fullName,
                        phone: phone,
                        role: selectedRole
                    }));

                    alert('Account successfully created! Welcome to Blood Bridge.');
                    navigateToRoleDashboard(selectedRole);
                } else {
                    // Supabase requires email verification before session is issued
                    alert(
                        `Account create ho gaya hai! 🎉\n\n` +
                        `Ek confirmation email "${email}" par bheja gaya hai.\n` +
                        `Kripya apne email inbox mein jaakar link par click karein aur apna account verify karein. Uske baad aap login kar sakte hain.`
                    );

                    // Switch view to login
                    if (window.toggleAuth) {
                        window.toggleAuth('login');
                    }
                    const loginEmailInput = document.querySelector('#login-view input[type="email"]');
                    if (loginEmailInput) {
                        loginEmailInput.value = email;
                    }
                }
            } catch (err) {
                console.error('Supabase signup error:', err);
                let message = err.message || 'Signup failed. Please try again.';
                if (/rate limit/i.test(message)) {
                    message = 'Email rate limit exceed ho gaya hai. Thodi der baad try karein ya Supabase Dashboard (Auth > Providers > Email) mein "Confirm email" disable karein.';
                } else if (/already registered|already exists/i.test(message)) {
                    message = 'Yeh email pehle se registered hai! Kripya Login karein.';
                }
                alert(message);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
            }
        });
    }

    // ==========================================
    // LOGIN LOGIC (Real Supabase + Fetch DB Profile)
    // ==========================================
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = loginForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Login →';

            const inputs = loginForm.querySelectorAll('.form-control');
            const email = inputs[0]?.value.trim();
            const password = inputs[1]?.value;

            if (!email || !password) {
                alert('Please enter both email and password.');
                return;
            }

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = 'Logging in... ⏳';
            }

            try {
                // 1. Supabase login with email & password
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) {
                    throw error;
                }

                if (!data?.session || !data?.user) {
                    throw new Error('Login failed: Session could not be established.');
                }

                const user = data.user;

                // 2. Fetch full user profile from database public.users table
                let userProfile = null;
                try {
                    const { data: dbProfile, error: pError } = await supabaseClient
                        .from('users')
                        .select('*')
                        .eq('id', user.id)
                        .maybeSingle();

                    if (!pError && dbProfile) {
                        userProfile = dbProfile;
                    } else {
                        // If profile doesn't exist yet in public.users, create it from auth metadata
                        const fallbackRole = user.user_metadata?.role || selectedRole || 'Donor';
                        const fallbackName = user.user_metadata?.full_name || email.split('@')[0];
                        const fallbackPhone = user.user_metadata?.phone || '';

                        const { data: newRow } = await supabaseClient
                            .from('users')
                            .upsert({
                                id: user.id,
                                full_name: fallbackName,
                                phone: fallbackPhone,
                                role: fallbackRole,
                                is_donor: fallbackRole === 'Donor',
                                is_available: false
                            }, { onConflict: 'id' })
                            .select()
                            .maybeSingle();

                        userProfile = newRow || {
                            id: user.id,
                            full_name: fallbackName,
                            phone: fallbackPhone,
                            role: fallbackRole
                        };
                    }
                } catch (dbErr) {
                    console.error('Error fetching database profile:', dbErr);
                }

                const effectiveRole = userProfile?.role || user.user_metadata?.role || selectedRole || 'Donor';
                const effectiveName = userProfile?.full_name || user.user_metadata?.full_name || email.split('@')[0];

                localStorage.setItem('blood_bridge_user_role', effectiveRole);
                localStorage.setItem('blood_bridge_user', JSON.stringify({
                    id: user.id,
                    email: user.email,
                    full_name: effectiveName,
                    phone: userProfile?.phone || user.user_metadata?.phone || '',
                    role: effectiveRole,
                    blood_group: userProfile?.blood_group || '',
                    city: userProfile?.city || ''
                }));

                alert(`Login Successful! Welcome, ${effectiveName}.`);
                navigateToRoleDashboard(effectiveRole);

            } catch (err) {
                console.error('Login error:', err);
                let message = err.message || 'Login failed.';
                if (/Invalid login credentials/i.test(message)) {
                    message = 'Galat email ya password! Kripya check karke dobara try karein.';
                } else if (/Email not confirmed/i.test(message)) {
                    message = 'Aapka email verify nahi hua hai! Kripya apne inbox mein confirmation link click karein, ya Supabase Dashboard > Authentication > Providers > Email mein "Confirm email" turn off karein.';
                }
                alert(message);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnText;
                }
            }
        });
    }

    // Google OAuth Handler (if enabled in future)
    document.querySelectorAll('[data-google-login]').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                const { error } = await supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: `${window.location.origin}/dashboard.html`
                    }
                });
                if (error) alert(`Google login error: ${error.message}`);
            } catch (err) {
                console.error('OAuth error:', err);
            }
        });
    });
});
