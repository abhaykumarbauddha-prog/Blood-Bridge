document.addEventListener('DOMContentLoaded', async () => {
    const client = window.bloodBridgeSupabase;
    if (!client?.auth) return;

    const { data: sessionData } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;

    const tabs = document.querySelectorAll('[data-settings-tab]');
    const sections = document.querySelectorAll('[data-settings-section]');
    const settingInputs = document.querySelectorAll('[data-setting]');
    let preferences = {};

    function setActiveTab(name) {
        tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.settingsTab === name));
        sections.forEach((section) => { section.hidden = section.dataset.settingsSection !== name; });
    }

    tabs.forEach((tab) => tab.addEventListener('click', () => setActiveTab(tab.dataset.settingsTab)));
    setActiveTab('security');

    const { data: profile } = await client.from('users').select('is_available').eq('id', user.id).maybeSingle();
    const { data: settings, error: settingsError } = await client
        .from('user_settings').select('preferences').eq('user_id', user.id).maybeSingle();
    if (settingsError && !/does not exist|schema cache/i.test(settingsError.message || '')) {
        console.error('Unable to load settings:', settingsError);
    }
    preferences = settings?.preferences || {};
    settingInputs.forEach((input) => {
        input.checked = input.dataset.setting === 'available_for_requests' && preferences[input.dataset.setting] === undefined
            ? profile?.is_available === true
            : preferences[input.dataset.setting] === true;
        input.addEventListener('change', async () => {
            preferences[input.dataset.setting] = input.checked;
            input.disabled = true;
            const { error } = await client.from('user_settings').upsert({ user_id: user.id, preferences }, { onConflict: 'user_id' });
            input.disabled = false;
            if (error) {
                input.checked = !input.checked;
                preferences[input.dataset.setting] = input.checked;
                alert(`Preference save failed: ${error.message}`);
                return;
            }
            if (input.dataset.setting === 'available_for_requests') {
                const { error: availabilityError } = await client.from('users')
                    .update({ is_available: input.checked, availability_status: input.checked ? 'Available' : 'Unavailable' })
                    .eq('id', user.id);
                if (availabilityError) alert(`Availability save failed: ${availabilityError.message}`);
            }
        });
    });

    const passwordFields = document.querySelectorAll('.form-group input[type="password"]');
    const updateButton = document.querySelector('[data-update-password]');
    if (!updateButton || passwordFields.length < 3) return;
    updateButton.addEventListener('click', async () => {
        const [currentPassword, newPassword, confirmPassword] = [...passwordFields].map((field) => field.value);
        if (!currentPassword || !newPassword || !confirmPassword) return alert('All password fields are required.');
        if (newPassword !== confirmPassword) return alert('New passwords do not match.');
        if (newPassword.length < 8) return alert('New password must be at least 8 characters.');

        updateButton.disabled = true;
        const { error: reauthError } = await client.auth.signInWithPassword({ email: user.email, password: currentPassword });
        if (reauthError) {
            updateButton.disabled = false;
            return alert('Current password is incorrect.');
        }
        const { error } = await client.auth.updateUser({ password: newPassword });
        updateButton.disabled = false;
        if (error) return alert(`Password update failed: ${error.message}`);
        passwordFields.forEach((field) => { field.value = ''; });
        alert('Password updated successfully.');
    });
});
