document.addEventListener('DOMContentLoaded', async () => {
    const client = window.bloodBridgeSupabase;
    if (!client?.auth) return;

    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;

    let { data: profile, error: profileError } = await client
        .from('users')
        .select('full_name, role, blood_group, phone, city, state, availability_status, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
    if (profileError && /avatar_url|column/i.test(profileError.message || '')) {
        const fallback = await client
            .from('users')
            .select('full_name, role, blood_group, phone, city, state, availability_status')
            .eq('id', user.id)
            .maybeSingle();
        profile = fallback.data;
    }
    if (!profile) return;

    const name = profile.full_name || user.email?.split('@')[0] || 'User';
    const role = profile.role || 'Donor';
    const avatar = profile.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=F5F7FA&color=101828`;
    const location = [profile.city, profile.state].filter(Boolean).join(', ') || 'Location not set';
    const bloodGroup = profile.blood_group || 'Not set';
    const phone = profile.phone || 'Not set';
    const availability = profile.availability_status || 'Available';

    document.querySelectorAll('[data-profile-avatar], .user-profile-mini img').forEach((image) => {
        image.src = avatar;
        image.alt = name;
    });
    document.querySelectorAll('[data-profile-name], .user-profile-mini h5').forEach((element) => {
        element.textContent = name;
    });
    document.querySelectorAll('[data-profile-role], .user-profile-mini p').forEach((element) => {
        element.textContent = role;
    });
    document.querySelectorAll('[data-profile-welcome]').forEach((element) => {
        element.textContent = `${name} 👋`;
    });
    document.querySelectorAll('[data-profile-card-name]').forEach((element) => {
        element.textContent = `${name} ✔`;
    });
    document.querySelectorAll('[data-profile-card-role]').forEach((element) => {
        element.textContent = role;
    });
    document.querySelectorAll('[data-profile-blood], [data-profile-blood-stat]').forEach((element) => {
        if (element.matches('[data-profile-blood-stat]')) element.textContent = bloodGroup;
        else element.textContent = `🩸 ${bloodGroup}`;
    });
    document.querySelectorAll('[data-profile-phone]').forEach((element) => {
        element.textContent = `📞 ${phone}`;
    });
    document.querySelectorAll('[data-profile-location]').forEach((element) => {
        element.textContent = `📍 ${location}`;
    });
    document.querySelectorAll('[data-profile-availability]').forEach((element) => {
        element.textContent = `${availability} to Donate`;
    });
});
