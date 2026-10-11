// frontend/js/map-service.js
/**
 * Blood Bridge - Unified Map & Geolocation Service
 * Powers interactive Leaflet OpenStreetMap views, 100 km radius filtering,
 * geocoding, and custom blood-pin markers across all dashboards and request views.
 */

const MapService = (() => {
    // Default fallback center: Lucknow, UP (India)
    const DEFAULT_COORDS = { lat: 26.8467, lng: 80.9462, name: 'Lucknow' };
    const DEFAULT_SEARCH_RADIUS_KM = 100;

    // Cache of common city/locality coordinates in Uttar Pradesh & India for instant zero-latency mapping
    const KNOWN_CITIES = {
        'lucknow': { lat: 26.8467, lng: 80.9462 },
        'kanpur': { lat: 26.4499, lng: 80.3319 },
        'unnao': { lat: 26.5393, lng: 80.4878 },
        'barabanki': { lat: 26.9272, lng: 81.1834 },
        'raebareli': { lat: 26.2236, lng: 81.2409 },
        'ayodhya': { lat: 26.7922, lng: 82.1998 },
        'faizabad': { lat: 26.7730, lng: 82.1460 },
        'sitapur': { lat: 27.5684, lng: 80.6829 },
        'hardoi': { lat: 27.3946, lng: 80.1311 },
        'prayagraj': { lat: 25.4358, lng: 81.8463 },
        'allahabad': { lat: 25.4358, lng: 81.8463 },
        'varanasi': { lat: 25.3176, lng: 82.9739 },
        'gorakhpur': { lat: 26.7606, lng: 83.3732 },
        'delhi': { lat: 28.6139, lng: 77.2090 },
        'noida': { lat: 28.5355, lng: 77.3910 },
        'agra': { lat: 27.1767, lng: 78.0081 },
        'meerut': { lat: 28.9845, lng: 77.7064 },
        'bareilly': { lat: 28.3670, lng: 79.4304 },
        'aligarh': { lat: 27.8974, lng: 78.0880 },
        'jhansi': { lat: 25.4484, lng: 78.5685 }
    };

    /**
     * Calculate distance between two coordinates in Kilometers using Haversine formula
     */
    function calculateDistanceKm(lat1, lon1, lat2, lon2) {
        if (!lat1 || !lon1 || !lat2 || !lon2) return null;
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

    /**
     * Check if a location is within the search radius (default 100 km)
     */
    function isWithinRadius(userLat, userLng, targetLat, targetLng, radiusKm = DEFAULT_SEARCH_RADIUS_KM) {
        const dist = calculateDistanceKm(userLat, userLng, targetLat, targetLng);
        if (dist === null) return true; // If coordinates unavailable, keep visible
        return dist <= radiusKm;
    }

    /**
     * Get user's current GPS position via browser Geolocation API
     */
    function getUserLocation() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                console.warn('Geolocation not supported by browser. Falling back to default center.');
                return resolve(DEFAULT_COORDS);
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        isLive: true
                    });
                },
                (err) => {
                    console.warn('Geolocation access failed or denied. Using default center:', err.message);
                    resolve(DEFAULT_COORDS);
                },
                { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
            );
        });
    }

    /**
     * Resolve latitude and longitude from city name or address
     */
    async function geocodeAddress(addressText) {
        if (!addressText) return DEFAULT_COORDS;
        const clean = addressText.trim().toLowerCase();

        // 1. Check known local cities cache
        for (const [cityName, coords] of Object.entries(KNOWN_CITIES)) {
            if (clean.includes(cityName)) {
                // Add tiny jitter (100-300m) for multiple pins in same city
                const jitterLat = (Math.random() - 0.5) * 0.015;
                const jitterLng = (Math.random() - 0.5) * 0.015;
                return { lat: coords.lat + jitterLat, lng: coords.lng + jitterLng };
            }
        }

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

        return DEFAULT_COORDS;
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
                const city = data.address.city || data.address.town || data.address.county || data.address.state_district || 'Lucknow';
                const displayName = data.display_name || `${city}, India`;
                return { city, displayName, raw: data.address };
            }
        } catch (e) {
            console.warn('Reverse geocoding error:', e);
        }
        return { city: 'Lucknow', displayName: 'Lucknow, Uttar Pradesh' };
    }

    /**
     * Initialize Leaflet map with standard tiles
     */
    function createMap(containerId, options = {}) {
        if (!window.L) {
            console.error('Leaflet library (L) is not loaded on the page.');
            return null;
        }

        const center = options.center || [DEFAULT_COORDS.lat, DEFAULT_COORDS.lng];
        const zoom = options.zoom || 11;

        const map = L.map(containerId, {
            center: center,
            zoom: zoom,
            zoomControl: true,
            scrollWheelZoom: options.scrollWheelZoom !== false
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 19
        }).addTo(map);

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
        DEFAULT_COORDS,
        DEFAULT_SEARCH_RADIUS_KM,
        calculateDistanceKm,
        isWithinRadius,
        getUserLocation,
        geocodeAddress,
        reverseGeocode,
        createMap,
        createBloodMarkerIcon,
        addRadiusCircle
    };
})();

// Attach to window
window.MapService = MapService;
