function clean(value) { return String(value ?? '').trim(); }

// Owner-approved fallback registry for the currently governed HUC service areas.
// Environment-provided centroids may extend or override this registry.
const GOVERNED_POSTAL_CENTROIDS = Object.freeze({
  L6V: { latitude: 43.7059, longitude: -79.7626 },
  L6P: { latitude: 43.7942, longitude: -79.7021 },
  M5V: { latitude: 43.6404, longitude: -79.3995 },
  85040: { latitude: 33.40585, longitude: -112.02658 },
});

function validPoint(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function configuredCentroid(postalCode, env) {
  let rows = {};
  try { rows = JSON.parse(env.GEOCODING_POSTAL_CENTROIDS_JSON || '{}'); } catch { rows = {}; }
  rows = { ...GOVERNED_POSTAL_CENTROIDS, ...rows };
  const normalized = clean(postalCode).toUpperCase().replace(/\s+/g, '');
  const canadianFsa = normalized.match(/[A-Z]\d[A-Z]/)?.[0];
  const usZip = normalized.match(/\d{5}/)?.[0];
  const keys = [...new Set([normalized, canadianFsa, usZip, normalized.slice(0, 3), normalized.slice(0, 5)].filter(Boolean))];
  for (const key of keys) {
    const value = rows[key];
    const latitude = Number(value?.latitude ?? value?.lat);
    const longitude = Number(value?.longitude ?? value?.lng ?? value?.lon);
    if (validPoint(latitude, longitude)) return { latitude, longitude, source: 'governed_postal_centroid_registry_v1', precision: 'postal_centroid' };
  }
  return null;
}

export async function geocodeServiceAddress({ addressLine1, city, subdivision, postalCode, countryCode }, env = process.env) {
  const key = clean(env.GOOGLE_MAPS_GEOCODING_API_KEY);
  if (key) {
    const address = [addressLine1, city, subdivision, postalCode, countryCode].map(clean).filter(Boolean).join(', ');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`, { signal: controller.signal });
      const payload = await response.json().catch(() => null);
      const location = payload?.results?.[0]?.geometry?.location;
      const latitude = Number(location?.lat); const longitude = Number(location?.lng);
      if (response.ok && payload?.status === 'OK' && validPoint(latitude, longitude)) {
        return { latitude, longitude, source: 'google_maps_geocoding', precision: payload.results[0]?.geometry?.location_type || 'provider' };
      }
    } catch { /* fall through to the configured centroid registry */ }
    finally { clearTimeout(timeout); }
  }
  return configuredCentroid(postalCode, env);
}
