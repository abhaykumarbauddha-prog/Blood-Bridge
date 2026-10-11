document.addEventListener('DOMContentLoaded', async () => {
    const client = window.bloodBridgeSupabase;
    const status = document.getElementById('profile-status');

    if (!client?.auth) {
        if (status) status.textContent = 'Authentication service unavailable.';
        return;
    }

    const setStatus = (message, isError = false) => {
        if (!status) return;
        status.textContent = message;
        status.style.color = isError ? 'var(--status-critical)' : 'var(--text-secondary)';
    };

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const user = sessionData?.session?.user;
    if (sessionError || !user) {
        window.location.href = 'auth.html';
        return;
    }

    const { data: profile, error: profileError } = await client
        .from('users')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (profileError) {
        setStatus(`Profile load failed: ${profileError.message}`, true);
        return;
    }

    const metadata = user.user_metadata || {};
    const current = { ...metadata, ...(profile || {}), email: user.email || '' };
    const fields = [
        'full_name', 'email', 'phone', 'date_of_birth', 'blood_group', 'gender',
        'address', 'city', 'state', 'pincode', 'country', 'last_donation_date',
        'weight_kg', 'medical_conditions', 'availability_status'
    ];

    fields.forEach((name) => {
        const input = document.querySelector(`[name="${name}"]`);
        if (input && current[name] !== undefined && current[name] !== null) {
            input.value = current[name];
        }
    });

    const name = current.full_name || user.email?.split('@')[0] || 'User';
    const bloodGroup = current.blood_group || 'Blood group not set';
    const city = current.city || 'Location not set';
    const role = current.role || 'Donor';
    const avatarUrl = current.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=F5F7FA&color=101828&size=120`;

    const profileName = document.getElementById('profile-name');
    profileName.textContent = `${name} `;
    const verifiedBadge = document.createElement('span');
    verifiedBadge.className = 'verified-badge';
    verifiedBadge.textContent = '✔';
    profileName.appendChild(verifiedBadge);
    document.getElementById('profile-summary').textContent = `${role} | ${bloodGroup} | ${city}`;
    document.getElementById('topbar-name').textContent = name;
    document.getElementById('topbar-role').textContent = role;
    document.getElementById('profile-avatar').src = avatarUrl;
    document.getElementById('topbar-avatar').src = avatarUrl;

    const avatarInput = document.getElementById('avatar-input');
    const editAvatar = document.getElementById('edit-avatar');
    const removeAvatar = document.getElementById('remove-avatar');
    const setAvatar = (url) => {
        document.querySelectorAll('#profile-avatar, #topbar-avatar, [data-profile-avatar]').forEach((image) => {
            image.src = url;
            image.alt = name;
        });
    };

    editAvatar.addEventListener('click', () => avatarInput.click());
    avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
            setStatus('Please select an image smaller than 2 MB.', true);
            avatarInput.value = '';
            return;
        }

        setStatus('Uploading photo...');
        const extension = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const filePath = `${user.id}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await client.storage
            .from('userprofilephotos')
            .upload(filePath, file, {
                cacheControl: '3600',
                upsert: true,
                contentType: file.type
            });
        if (uploadError) {
            setStatus(`Photo upload failed: ${uploadError.message}`, true);
            return;
        }

        const { data: publicData } = client.storage.from('userprofilephotos').getPublicUrl(filePath);
        const publicUrl = publicData.publicUrl;
        const { error: profileError } = await client.from('users').update({ avatar_url: publicUrl }).eq('id', user.id);
        if (profileError) {
            setStatus(`Photo save failed: ${profileError.message}`, true);
            return;
        }
        await client.auth.updateUser({ data: { avatar_url: publicUrl } });
        setAvatar(publicUrl);
        setStatus('Profile photo updated.');
    });

    removeAvatar.addEventListener('click', async () => {
        if (!current.avatar_url) {
            setStatus('No custom profile photo to remove.');
            return;
        }
        setStatus('Removing photo...');
        const { error } = await client.from('users').update({ avatar_url: null }).eq('id', user.id);
        if (error) {
            setStatus(`Photo remove failed: ${error.message}`, true);
            return;
        }
        await client.auth.updateUser({ data: { avatar_url: null } });
        const fallbackAvatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=F5F7FA&color=101828&size=120`;
        setAvatar(fallbackAvatar);
        setStatus('Profile photo removed.');
    });

    const lastDonation = current.last_donation_date ? new Date(`${current.last_donation_date}T00:00:00`) : null;
    const eligibilityBox = document.querySelector('.eligibility-box');
    const eligibilityTitle = document.getElementById('eligibility-title');
    const eligibilityMessage = document.getElementById('eligibility-message');
    const eligibilityIcon = document.getElementById('eligibility-icon');

    if (lastDonation && !Number.isNaN(lastDonation.getTime())) {
        const eligibleDate = new Date(lastDonation);
        eligibleDate.setDate(eligibleDate.getDate() + 90);
        const formattedDate = eligibleDate.toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric'
        });
        const isEligible = new Date() >= eligibleDate;
        eligibilityBox.classList.toggle('pending', !isEligible);
        eligibilityIcon.textContent = isEligible ? '✅' : '⏱️';
        eligibilityTitle.textContent = isEligible ? 'Eligible to Donate' : 'Cooling Period';
        eligibilityTitle.style.color = isEligible ? 'var(--status-available)' : 'var(--status-pending)';
        eligibilityMessage.innerHTML = isEligible
            ? 'You are currently eligible to donate blood.'
            : `You can donate again on <strong>${formattedDate}</strong>.`;
    } else {
        eligibilityMessage.textContent = 'Add your last donation date to calculate eligibility.';
    }

    const saveButton = document.getElementById('save-profile');
    saveButton.addEventListener('click', async () => {
        const getValue = (name) => document.querySelector(`[name="${name}"]`)?.value.trim() || null;
        const updates = {
            full_name: getValue('full_name'),
            phone: getValue('phone'),
            date_of_birth: getValue('date_of_birth'),
            blood_group: getValue('blood_group'),
            gender: getValue('gender'),
            address: getValue('address'),
            city: getValue('city'),
            state: getValue('state'),
            pincode: getValue('pincode'),
            country: getValue('country') || 'India',
            last_donation_date: getValue('last_donation_date'),
            weight_kg: getValue('weight_kg') ? Number(getValue('weight_kg')) : null,
            medical_conditions: getValue('medical_conditions'),
            availability_status: getValue('availability_status') || 'Available'
        };

        if (!updates.full_name || !updates.phone) {
            setStatus('Name and phone are required.', true);
            return;
        }

        saveButton.disabled = true;
        setStatus('Saving...');
        const verificationFields = 'id,full_name,phone,blood_group,city,last_donation_date,availability_status';
        let saveResult = await client
            .from('users')
            .update(updates)
            .eq('id', user.id)
            .select(verificationFields)
            .maybeSingle();
        let error = saveResult.error;
        let savedProfile = saveResult.data;
        saveButton.disabled = false;

        // Keep core profile updates working while an older database schema is being migrated.
        if (error && /column .* does not exist|could not find the .* column/i.test(error.message || '')) {
            const coreUpdates = {
                full_name: updates.full_name,
                phone: updates.phone,
                blood_group: updates.blood_group,
                city: updates.city,
                last_donation_date: updates.last_donation_date,
                availability_status: updates.availability_status
            };
            const fallback = await client
                .from('users')
                .update(coreUpdates)
                .eq('id', user.id)
                .select(verificationFields)
                .maybeSingle();
            error = fallback.error;
            savedProfile = fallback.data;
            if (!error) {
                setStatus('Basic profile saved. Run database/schema.sql to enable all fields.', false);
            }
        }

        // A profile row can be missing for users created before the signup trigger.
        if (!error && !savedProfile) {
            const profile = {
                id: user.id,
                full_name: updates.full_name,
                phone: updates.phone,
                role: current.role || 'Donor',
                blood_group: updates.blood_group,
                city: updates.city,
                last_donation_date: updates.last_donation_date,
                availability_status: updates.availability_status
            };
            const insertResult = await client
                .from('users')
                .insert(profile)
                .select(verificationFields)
                .maybeSingle();
            error = insertResult.error;
            savedProfile = insertResult.data;
        }

        if (error) {
            setStatus(`Save failed: ${error.message}`, true);
            return;
        }

        setStatus('Profile saved successfully.');
        const savedName = savedProfile?.full_name || updates.full_name;
        document.querySelector('[name="full_name"]').value = savedName;
        document.getElementById('profile-summary').textContent = `${role} | ${savedProfile?.blood_group || updates.blood_group || 'Blood group not set'} | ${savedProfile?.city || updates.city || 'Location not set'}`;
        document.getElementById('profile-name').firstChild.textContent = `${savedName} `;
        document.getElementById('topbar-name').textContent = savedName;
    });

    document.getElementById('share-profile').addEventListener('click', async () => {
        const shareData = { title: `${name} | Blood Bridge`, text: `${name} is a ${role} on Blood Bridge.` };
        if (navigator.share) {
            await navigator.share(shareData).catch(() => {});
        } else {
            await navigator.clipboard?.writeText(window.location.href);
            setStatus('Profile link copied.');
        }
    });
});
