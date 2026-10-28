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
    let locationCoordinates = {
        latitude: Number(current.latitude),
        longitude: Number(current.longitude)
    };
    const fields = [
        'full_name', 'email', 'phone', 'date_of_birth', 'blood_group', 'gender',
        'address', 'city', 'state', 'pincode', 'country', 'last_donation_date',
        'weight_kg', 'medical_conditions', 'availability_status', 'hospital_type'
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
    const avatarUrl = current.avatar_url || 'assets/profile-placeholder.svg';

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
    const setLocationButton = document.getElementById('set-profile-location');
    const locationStatus = document.getElementById('profile-location-status');
    const coordsDisplay = document.getElementById('profile-location-coords');
    const mapStatus = document.getElementById('profile-map-status');

    let profileMap = null;
    let profileMarker = null;

    const setMapStatus = (message, isError = false) => {
        if (!mapStatus) return;
        mapStatus.textContent = message;
        mapStatus.style.color = isError ? 'var(--status-critical)' : 'var(--brand-primary)';
    };

    const updateCoordsDisplay = (lat, lng) => {
        if (!coordsDisplay) return;
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            coordsDisplay.textContent = `${Number(lat).toFixed(4)}°, ${Number(lng).toFixed(4)}°`;
        } else {
            coordsDisplay.textContent = 'Drag arrow pin or click map to reposition';
        }
    };

    const handleNewCoordinates = async (lat, lng, shouldReverseGeocode = true) => {
        locationCoordinates = { latitude: Number(lat), longitude: Number(lng) };
        updateCoordsDisplay(lat, lng);
        if (locationStatus) {
            locationStatus.textContent = 'A saved location is available for donor maps.';
        }

        if (shouldReverseGeocode && window.MapService?.reverseGeocode) {
            setMapStatus('Resolving address...');
            try {
                const geo = await window.MapService.reverseGeocode(lat, lng);
                if (geo) {
                    if (geo.city) {
                        const cityInput = document.querySelector('[name="city"]');
                        if (cityInput) cityInput.value = geo.city;
                    }
                    if (geo.state) {
                        const stateInput = document.querySelector('[name="state"]');
                        if (stateInput) stateInput.value = geo.state;
                    }
                    if (geo.pincode) {
                        const pinInput = document.querySelector('[name="pincode"]');
                        if (pinInput) pinInput.value = geo.pincode;
                    }
                    if (geo.address) {
                        const addrInput = document.querySelector('[name="address"]');
                        if (addrInput && (!addrInput.value || addrInput.value.trim() === '')) {
                            addrInput.value = geo.address;
                        }
                    }
                    setMapStatus('Location pinned');
                } else {
                    setMapStatus('Location pinned');
                }
            } catch (geoErr) {
                console.warn('Reverse geocode error:', geoErr);
                setMapStatus('Location pinned');
            }
        } else {
            setMapStatus('Location pinned');
        }
    };

    function initProfileMap() {
        const mapContainer = document.getElementById('profile-location-map');
        if (!mapContainer || !window.L || !window.MapService) {
            return;
        }

        const hasSaved = Number.isFinite(locationCoordinates.latitude) && Number.isFinite(locationCoordinates.longitude);
        const initialLat = hasSaved ? locationCoordinates.latitude : 26.8467;
        const initialLng = hasSaved ? locationCoordinates.longitude : 80.9462;
        const initialZoom = hasSaved ? 14 : 11;

        try {
            profileMap = window.MapService.createMap(mapContainer, {
                center: [initialLat, initialLng],
                zoom: initialZoom
            });

            if (!profileMap) return;

            const pinIcon = window.MapService.createDraggableArrowPin('My Location', '#E60023');
            profileMarker = L.marker([initialLat, initialLng], {
                draggable: true,
                icon: pinIcon || undefined
            }).addTo(profileMap);

            if (hasSaved) {
                updateCoordsDisplay(initialLat, initialLng);
                setMapStatus('Saved location loaded');
            } else {
                updateCoordsDisplay(null, null);
                setMapStatus('Click map or search address');
            }

            profileMarker.on('dragend', async () => {
                const pos = profileMarker.getLatLng();
                await handleNewCoordinates(pos.lat, pos.lng, true);
            });

            profileMap.on('click', async (e) => {
                const { lat, lng } = e.latlng;
                profileMarker.setLatLng([lat, lng]);
                await handleNewCoordinates(lat, lng, true);
            });

            // Map search input
            const mapSearchInput = document.getElementById('profile-map-search');
            if (mapSearchInput) {
                mapSearchInput.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        const query = mapSearchInput.value.trim();
                        if (!query) return;
                        setMapStatus('Searching address...');
                        const result = await window.MapService.geocodeAddress(query);
                        if (result && Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
                            profileMap.setView([result.lat, result.lng], 14);
                            profileMarker.setLatLng([result.lat, result.lng]);
                            await handleNewCoordinates(result.lat, result.lng, true);
                            setMapStatus('Location found');
                        } else {
                            setMapStatus('Address not found', true);
                        }
                    }
                });
            }

            // Locate Me button in Location Details card
            const btnDonorLocateMe = document.getElementById('btn-donor-locate-me');
            if (btnDonorLocateMe) {
                btnDonorLocateMe.addEventListener('click', async () => {
                    btnDonorLocateMe.disabled = true;
                    setMapStatus('Detecting GPS location...');
                    const loc = await window.MapService.getUserLocation(true);
                    btnDonorLocateMe.disabled = false;
                    if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
                        profileMap.setView([loc.lat, loc.lng], 15);
                        profileMarker.setLatLng([loc.lat, loc.lng]);
                        await handleNewCoordinates(loc.lat, loc.lng, true);
                        setMapStatus('GPS location detected');
                    } else {
                        setMapStatus('GPS unavailable', true);
                    }
                });
            }
        } catch (err) {
            console.error('Error initializing profile map:', err);
        }
    }

    if (locationStatus && locationCoordinates.latitude && locationCoordinates.longitude) {
        locationStatus.textContent = 'A saved location is available for donor maps.';
    }
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
        const fallbackAvatar = 'assets/profile-placeholder.svg';
        setAvatar(fallbackAvatar);
        setStatus('Profile photo removed.');
    });

    if (setLocationButton) {
        setLocationButton.addEventListener('click', async () => {
            setLocationButton.disabled = true;
            const location = await MapService.getUserLocation();
            if (!location) {
                if (locationStatus) locationStatus.textContent = 'Location unavailable. Allow browser location access and try again.';
                setLocationButton.disabled = false;
                return;
            }
            const { error } = await client.from('users').update({ latitude: location.lat, longitude: location.lng }).eq('id', user.id);
            setLocationButton.disabled = false;
            if (error) {
                setStatus(`Location save failed: ${error.message}`, true);
                return;
            }
            locationCoordinates = { latitude: location.lat, longitude: location.lng };
            if (profileMap && profileMarker) {
                profileMap.setView([location.lat, location.lng], 15);
                profileMarker.setLatLng([location.lat, location.lng]);
            }
            await handleNewCoordinates(location.lat, location.lng, true);
            if (locationStatus) locationStatus.textContent = 'Current location saved for donor maps.';
            setStatus('Location saved.');
        });
    }

    const donorStats = await BloodMatchData.getDonorStats(user.id);
    BloodMatchData.renderDonorStats(donorStats);

    initProfileMap();

    const saveButton = document.getElementById('save-profile');
    saveButton.addEventListener('click', async () => {
        const getValue = (name) => document.querySelector(`[name="${name}"]`)?.value.trim() || null;
        const updates = {
            full_name: getValue('full_name'),
            phone: getValue('phone'),
            date_of_birth: getValue('date_of_birth'),
            blood_group: getValue('blood_group'),
            gender: getValue('gender'),
            hospital_type: getValue('hospital_type'),
            address: getValue('address'),
            city: getValue('city'),
            state: getValue('state'),
            pincode: getValue('pincode'),
            country: getValue('country') || 'India',
            last_donation_date: getValue('last_donation_date'),
            weight_kg: getValue('weight_kg') ? Number(getValue('weight_kg')) : null,
            medical_conditions: getValue('medical_conditions'),
            availability_status: getValue('availability_status') || 'Available',
            is_available: getValue('availability_status') === 'Available',
            latitude: Number.isFinite(locationCoordinates.latitude) ? locationCoordinates.latitude : null,
            longitude: Number.isFinite(locationCoordinates.longitude) ? locationCoordinates.longitude : null
        };

        if (!updates.full_name || !updates.phone) {
            setStatus('Name and phone are required.', true);
            return;
        }

        saveButton.disabled = true;
        setStatus('Saving...');
        const verificationFields = 'id,full_name,phone,blood_group,city,last_donation_date,availability_status,hospital_type';
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

        // Refresh stats, cooling period, and badges immediately
        if (window.BloodMatchData?.getDonorStats && window.BloodMatchData?.renderDonorStats) {
            try {
                const refreshedStats = await BloodMatchData.getDonorStats(user.id);
                BloodMatchData.renderDonorStats(refreshedStats);
            } catch (statErr) {
                console.warn('Profile stats refresh error:', statErr);
            }
        }
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
