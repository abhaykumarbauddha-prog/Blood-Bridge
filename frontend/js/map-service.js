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
     * Get user's current GPS position via browser Geolocation API with high accuracy
     */
    async function getUserLocation(fallbackOnFail = true) {
        const livePromise = new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('Geolocation is not supported by this browser.');
                return resolve(null);
            }

            const timeoutId = setTimeout(() => {
                resolve(null);
            }, 7000);

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
                { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
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
     * Resolve latitude and longitude from city name or address (India prioritized)
     */
    async function geocodeAddress(addressText) {
        if (!addressText) return null;

        try {
            const query = addressText.includes('India') ? addressText : `${addressText}, India`;
            const encoded = encodeURIComponent(query);
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=in&q=${encoded}&limit=3`, {
                headers: { 'Accept': 'application/json' }
            });
            const data = await res.json();
            if (data && data.length > 0) {
                return { 
                    lat: parseFloat(data[0].lat), 
                    lng: parseFloat(data[0].lon),
                    displayName: data[0].display_name
                };
            }
        } catch (e) {
            console.warn('Indian geocoding failed:', e);
        }

        return null;
    }

    /**
     * Reverse geocode coordinates to get address/city/state/pincode
     */
    async function reverseGeocode(lat, lng) {
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`, {
                headers: { 'Accept': 'application/json' }
            });
            const data = await res.json();
            if (data && data.address) {
                const addr = data.address;
                const city = addr.city || addr.town || addr.village || addr.county || addr.state_district || '';
                const state = addr.state || '';
                const pincode = addr.postcode || '';
                const road = [addr.building || addr.amenity, addr.road, addr.suburb || addr.neighbourhood].filter(Boolean).join(', ');
                const displayName = data.display_name || [road, city, state].filter(Boolean).join(', ') || 'Selected Location';
                return { 
                    city, 
                    state, 
                    pincode, 
                    address: road || displayName, 
                    displayName, 
                    raw: addr 
                };
            }
        } catch (e) {
            console.warn('Reverse geocoding error:', e);
        }
        return null;
    }

    /**
     * Initialize Leaflet map with Dual Layer Switcher (Standard Street + NavIC / Satellite)
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

        // 1. Production-Grade Street Layer (CARTO Voyager - Fast CDN, OpenStreetMap data, no 403 blocks on deployed apps)
        const streetLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        });

        // 2. NavIC / High-Resolution Satellite Layer (ISRO / NavIC aligned)
        const navicSatelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; NavIC / ISRO Geoportal, Esri Imagery',
            maxZoom: 18
        });

        // 3. Indian Administrative & Street Labels Overlay
        const labelsOverlay = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
            attribution: 'Labels &copy; NavIC / OSM / CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        });

        // Default to Standard Street (CARTO Voyager)
        streetLayer.addTo(map);

        // Add Layer Switcher Control in top-right corner
        const baseMaps = {
            "🗺️ Standard Street": streetLayer,
            "🛰️ 🇮🇳 NavIC / Satellite": navicSatelliteLayer
        };
        const overlayMaps = {
            "🏷️ Locality Labels": labelsOverlay
        };
        L.control.layers(baseMaps, overlayMaps, { position: 'topright' }).addTo(map);

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
     * Create an interactive draggable location arrow/pin marker
     */
    function createDraggableArrowPin(label = 'Drag to Set Location', color = '#E60023') {
        if (!window.L) return null;
        return L.divIcon({
            className: 'custom-draggable-arrow-pin',
            html: `
                <div style="position: relative; display: flex; flex-direction: column; align-items: center; cursor: grab;">
                    <div style="
                        background: ${color};
                        color: #FFFFFF;
                        padding: 3px 8px;
                        border-radius: 12px;
                        font-size: 11px;
                        font-weight: 700;
                        white-space: nowrap;
                        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
                        border: 2px solid #FFFFFF;
                        margin-bottom: 2px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        pointer-events: none;
                        user-select: none;
                    ">
                        <span>📍</span> ${label}
                    </div>
                    <svg width="34" height="42" viewBox="0 0 34 42" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 4px 6px rgba(0,0,0,0.4));">
                        <path d="M17 0C7.61 0 0 7.61 0 17C0 27.5 14.5 40.5 15.8 41.6C16.5 42.2 17.5 42.2 18.2 41.6C19.5 40.5 34 27.5 34 17C34 7.61 26.39 0 17 0Z" fill="${color}" stroke="#FFFFFF" stroke-width="2"/>
                        <circle cx="17" cy="17" r="7" fill="#FFFFFF"/>
                        <!-- Directional Arrow Inside Pin -->
                        <path d="M17 12L21 19H13L17 12Z" fill="${color}"/>
                    </svg>
                </div>
            `,
            iconSize: [34, 62],
            iconAnchor: [17, 62],
            popupAnchor: [0, -58]
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
        createDraggableArrowPin,
        addRadiusCircle
    };
})();

// Attach to window
window.MapService = MapService;
