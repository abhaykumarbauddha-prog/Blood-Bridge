// frontend/js/map-service.js
/**
 * Blood Bridge - Unified Map & Geolocation Service
 * Powers interactive Leaflet OpenStreetMap views, 100 km radius filtering,
 * geocoding, and custom blood-pin markers across all dashboards and request views.
 */

const MapService = (() => {
    const DEFAULT_SEARCH_RADIUS_KM = 100;

    /**
     * Calculate distance between two coordinates in Kilometers using Haversine formula
     */
    function calculateDistanceKm(lat1, lon1, lat2, lon2) {
        if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
        const R = 6371; // Earth's radius in KM
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return parseFloat((R * c).toFixed(1));
    }

    const DEFAULT_FALLBACK_COORDS = { lat: 26.8467, lng: 80.9462, city: 'Lucknow', isFallback: true, isLive: false };

    /**
     * Get user's current GPS position via browser Geolocation API with resilient fallback
     */
    async function getUserLocation(fallbackOnFail = true) {
        const livePromise = new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('Geolocation is not supported by this browser.');
                return resolve(null);
            }

            const timeoutId = setTimeout(() => {
                resolve(null);
            }, 4000);

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    clearTimeout(timeoutId);
                    resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        isLive: true
                    });
                },
                (err) => {
                    clearTimeout(timeoutId);
                    console.warn('Geolocation access failed or denied:', err.message);
                    resolve(null);
                },
                { enableHighAccuracy: true, timeout: 4000, maximumAge: 60000 }
            );
        });

        const liveLoc = await livePromise;
        if (liveLoc) return liveLoc;
        if (!fallbackOnFail) return null;

        // Try getting saved coordinates from Supabase user session
        try {
            const supabase = window.bloodBridgeSupabase;
            if (supabase?.auth) {
                const { data: sessionData } = await supabase.auth.getSession();
                const userId = sessionData?.session?.user?.id;
                if (userId) {
                    const { data: profile } = await supabase
                        .from('users')
                        .select('latitude, longitude, city, state')
                        .eq('id', userId)
                        .maybeSingle();

                    const pLat = Number(profile?.latitude);
                    const pLng = Number(profile?.longitude);
                    if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
                        return {
                            lat: pLat,
                            lng: pLng,
                            city: profile.city || 'Profile Location',
                            isProfile: true,
                            isLive: false
                        };
                    }
                }
            }
        } catch (e) {
            console.warn('Failed to load profile coordinates fallback:', e);
        }

        // Standard Indian Regional Fallback
        return { ...DEFAULT_FALLBACK_COORDS };
    }

    function getDefaultLocation() {
        return { ...DEFAULT_FALLBACK_COORDS };
    }

    /**
     * Resolve latitude and longitude from city name or address
     */
    async function geocodeAddress(addressText) {
        if (!addressText) return null;

        // 2. Fallback to OpenStreetMap Nominatim Free Geocoder
        try {
            const encoded = encodeURIComponent(`${addressText}, India`);
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&limit=1`, {
                headers: { 'Accept': 'application/json' }
            });
            const data = await res.json();
            if (data && data.length > 0) {
                return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
            }
        } catch (e) {
            console.warn('OSM Geocoding failed:', e);
        }

        return null;
    }

    /**
     * Reverse geocode coordinates to get address/city
     */
    async function reverseGeocode(lat, lng) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
                headers: { 'Accept': 'application/json' }
            });
            const data = await res.json();
            if (data && data.address) {
                const city = data.address.city || data.address.town || data.address.county || data.address.state_district;
                const displayName = data.display_name || city || 'Location found';
                return { city, displayName, raw: data.address };
            }
        } catch (e) {
            console.warn('Reverse geocoding error:', e);
        }
        return null;
    }

    /**
     * Initialize Leaflet map with standard tiles
     */
    function createMap(containerId, options = {}) {
        if (!window.L) {
            console.error('Leaflet library (L) is not loaded on the page.');
            return null;
        }

        const containerEl = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (!containerEl) {
            console.warn('Map container element not found:', containerId);
            return null;
        }

        // Guard against "Map container is already initialized"
        if (containerEl._leaflet_id) {
            try {
                containerEl._leaflet_id = null;
            } catch (e) {}
        }

        let center = options.center;
        if (!Array.isArray(center) || center.length !== 2 || !center.every(Number.isFinite)) {
            center = [DEFAULT_FALLBACK_COORDS.lat, DEFAULT_FALLBACK_COORDS.lng];
        }
        const zoom = options.zoom || 11;

        const map = L.map(containerEl, {
            center: center,
            zoom: zoom,
            zoomControl: true,
            scrollWheelZoom: options.scrollWheelZoom !== false
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);

        setTimeout(() => {
            try {
                map.invalidateSize();
            } catch (e) {}
        }, 300);

        return map;
    }

    /**
     * Create a custom styled HTML Marker for Blood Bridge
     */
    function createBloodMarkerIcon(bloodGroup = 'O+', urgency = 'Normal', isUserLocation = false) {
        if (!window.L) return null;

        if (isUserLocation) {
            return L.divIcon({
                className: 'custom-leaflet-user-pin',
                html: `
                    <div style="
                        width: 28px; height: 28px; 
                        background: #2563EB; 
                        border: 3px solid #FFFFFF; 
                        border-radius: 50%; 
                        box-shadow: 0 0 12px rgba(37,99,235,0.6);
                        display: flex; align-items: center; justify-content: center;
                        color: white; font-size: 14px;
                    ">🎯</div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });
        }

        const isCritical = urgency.toLowerCase() === 'critical';
        const isUrgent = urgency.toLowerCase() === 'urgent';
        const bgColor = isCritical ? '#E60023' : (isUrgent ? '#F59E0B' : '#FFFFFF');
        const textColor = (isCritical || isUrgent) ? '#FFFFFF' : '#E60023';
        const borderColor = isCritical ? '#FFFFFF' : '#E60023';

        return L.divIcon({
            className: 'custom-leaflet-blood-pin',
            html: `
                <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
                    <div style="
                        min-width: 34px; height: 34px; padding: 0 6px;
                        background: ${bgColor}; 
                        color: ${textColor}; 
                        border: 2px solid ${borderColor}; 
                        border-radius: 50px; 
                        display: flex; align-items: center; justify-content: center; 
                        font-weight: 800; font-size: 12px; font-family: inherit;
                        box-shadow: 0 4px 10px rgba(230,0,35,0.35);
                        letter-spacing: -0.5px;
                    ">${bloodGroup}</div>
                    <div style="
                        width: 0; height: 0; 
                        border-left: 5px solid transparent; 
                        border-right: 5px solid transparent; 
                        border-top: 6px solid ${isCritical ? '#E60023' : (isUrgent ? '#F59E0B' : '#E60023')};
                    "></div>
                </div>
            `,
            iconSize: [36, 42],
            iconAnchor: [18, 42],
            popupAnchor: [0, -38]
        });
    }

    /**
     * Add a 100 KM radius boundary circle
     */
    function addRadiusCircle(map, lat, lng, radiusKm = DEFAULT_SEARCH_RADIUS_KM) {
        if (!window.L || !map) return null;
        return L.circle([lat, lng], {
            radius: radiusKm * 1000,
            color: '#E60023',
            weight: 1.5,
            dashArray: '6, 6',
            fillColor: '#E60023',
            fillOpacity: 0.05
        }).addTo(map);
    }

    return {
        DEFAULT_SEARCH_RADIUS_KM,
        calculateDistanceKm,
        getUserLocation,
        getDefaultLocation,
        geocodeAddress,
        reverseGeocode,
        createMap,
        createBloodMarkerIcon,
        addRadiusCircle
    };
})();

// Attach to window
window.MapService = MapService;
