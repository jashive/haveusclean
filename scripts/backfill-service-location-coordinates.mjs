import { geocodeServiceAddress } from '../server-internal/service-location-geocoding.js';

const apply = process.argv.includes('--apply');
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error('Supabase URL and secret key are required.');

async function request(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await response.text(); const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text}`);
  return data;
}

const jobs = await request('operational_job?select=service_location_id&order=created_at.asc&limit=12');
const locationIds = [...new Set(jobs.map((row) => row.service_location_id).filter(Boolean))];
const rows = locationIds.length ? await request(`service_location?select=id,address_line1,city,subdivision,postal_code,country_code&id=in.(${locationIds.join(',')})&latitude=is.null&longitude=is.null`) : [];
const results = [];
for (const row of rows) {
  const point = await geocodeServiceAddress({ addressLine1: row.address_line1, city: row.city, subdivision: row.subdivision, postalCode: row.postal_code, countryCode: row.country_code });
  if (!point) { results.push({ id: row.id, status: 'unresolved' }); continue; }
  if (apply) await request('rpc/service_role_set_location_geocode', { method: 'POST', body: JSON.stringify({ p_service_location_id: row.id, p_latitude: point.latitude, p_longitude: point.longitude, p_source: `phase3_backfill:${point.source}`, p_precision: point.precision }) });
  results.push({ id: row.id, status: apply ? 'updated' : 'dry_run', source: point.source, precision: point.precision });
}
process.stdout.write(`${JSON.stringify({ apply, candidates: rows.length, results }, null, 2)}\n`);
