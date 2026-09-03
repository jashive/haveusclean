import { requireServiceosServerTarget } from '../../src/server/serviceosServerEnvironment.js';
import {
  GOVERNED_RESIDENTIAL_CONFIG_TYPE,
  GOVERNED_RESIDENTIAL_REQUIRED_STATUS,
  getGovernedResidentialRequiredVersion,
} from '../../src/lib/governedResidentialConfig.js';
import { computeGovernedResidentialQuote } from '../../src/lib/governedResidentialPricing.js';
import {
  applyGovernedResidentialAddons,
  getDefaultApprovedSelections,
  removeBundledAddonsForPackage,
} from '../../src/lib/serviceosOfficeQuoteUtils.js';

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function normalizeMarket(value) {
  const token = String(value || '').trim().toUpperCase();
  if (['ON', 'HUC-ON', 'ONTARIO'].includes(token)) return 'HUC-ON';
  if (['AZ', 'HUC-AZ', 'ARIZONA'].includes(token)) return 'HUC-AZ';
  throw httpError(400, 'Select Ontario or Arizona.', 'BOOKING_MARKET_INVALID');
}

function serverConfig() {
  requireServiceosServerTarget(process.env, {
    allowProduction: true,
    allowNonProduction: true,
    requireProductionApproval: true,
  });
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const secret = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !secret) throw httpError(503, 'Public booking server configuration is incomplete.', 'BOOKING_SERVER_CONFIG_MISSING');
  return { url, secret };
}

async function rest(path, config) {
  const response = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.secret,
      Authorization: `Bearer ${config.secret}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) throw httpError(502, 'Governed booking pricing lookup failed.', 'BOOKING_PRICING_LOOKUP_FAILED');
  return Array.isArray(data) ? data : [];
}

async function loadMarketContext(businessUnitCode, config) {
  const units = await rest(
    `business_unit?select=id,organization_id,jurisdiction_id,code,name,status&code=eq.${encodeURIComponent(businessUnitCode)}&status=eq.active&limit=2`,
    config
  );
  if (units.length !== 1) throw httpError(503, 'Booking market is not uniquely configured.', 'BOOKING_MARKET_CONFIG_INVALID');
  const unit = units[0];
  if (!unit.jurisdiction_id) throw httpError(503, 'Booking jurisdiction is missing.', 'BOOKING_JURISDICTION_MISSING');

  const jurisdictions = await rest(
    `jurisdiction?select=id,code,country_code,subdivision_code,currency_code,timezone,tax_label,default_tax_rate&id=eq.${encodeURIComponent(unit.jurisdiction_id)}&limit=1`,
    config
  );
  const jurisdiction = jurisdictions[0];
  if (!jurisdiction?.id) throw httpError(503, 'Booking jurisdiction is unavailable.', 'BOOKING_JURISDICTION_MISSING');
  return { unit, jurisdiction };
}

async function loadPublishedPricing(context, config) {
  const requiredVersion = getGovernedResidentialRequiredVersion(context.unit.code);
  const select = 'id,organization_id,business_unit_id,jurisdiction_id,configuration_type,version,status,effective_from,effective_to,configuration';
  const rows = await rest(
    `configuration_version?select=${select}` +
    `&organization_id=eq.${encodeURIComponent(context.unit.organization_id)}` +
    `&business_unit_id=eq.${encodeURIComponent(context.unit.id)}` +
    `&jurisdiction_id=eq.${encodeURIComponent(context.jurisdiction.id)}` +
    `&configuration_type=eq.${encodeURIComponent(GOVERNED_RESIDENTIAL_CONFIG_TYPE)}` +
    `&status=eq.${encodeURIComponent(GOVERNED_RESIDENTIAL_REQUIRED_STATUS)}` +
    `&version=eq.${encodeURIComponent(requiredVersion)}&limit=2`,
    config
  );
  if (rows.length !== 1) throw httpError(503, 'Published residential pricing is unavailable.', 'BOOKING_PRICING_CONFIG_INVALID');
  return rows[0];
}

export async function calculatePublicBookingQuote(body, config = serverConfig()) {
  const businessUnitCode = normalizeMarket(body?.market || body?.businessUnitCode);
  const context = await loadMarketContext(businessUnitCode, config);
  const configurationVersion = await loadPublishedPricing(context, config);

  const packageKey = String(body?.packageKey || 'essential_refresh').trim();
  const dwellingType = String(body?.dwellingType || 'apartment').trim();
  const beds = Number(body?.bedrooms ?? body?.beds ?? 1);
  const baths = Number(body?.bathrooms ?? body?.baths ?? 1);
  const condition = String(body?.condition || 'light').trim();
  const frequency = String(body?.frequency || 'one_time').trim();
  const sqft = body?.sqft === '' || body?.sqft == null ? null : Number(body.sqft);
  const requestedAddons = Array.isArray(body?.addons) ? body.addons : [];
  const addons = removeBundledAddonsForPackage({
    packageKey,
    addons: requestedAddons,
    businessUnitCode,
    configurationVersion,
  });
  const approvedSelections = getDefaultApprovedSelections(configurationVersion, {
    condition,
    frequency,
    sqftBand: null,
    sqft,
  });

  const base = computeGovernedResidentialQuote({
    configurationVersion,
    dwellingType,
    beds,
    baths,
    packageKey,
    condition,
    frequency,
    addons,
    approvedSelections,
  });
  if (base?.requiresOfficeReview) {
    return {
      requiresOfficeReview: true,
      reason: base.reason,
      market: businessUnitCode,
      currencyCode: context.jurisdiction.currency_code,
      taxName: context.jurisdiction.tax_label,
      taxRate: Number(context.jurisdiction.default_tax_rate || 0),
      configurationVersionId: configurationVersion.id,
      configurationVersion: configurationVersion.version,
    };
  }

  const quote = applyGovernedResidentialAddons(base, configurationVersion, addons);
  return {
    ...quote,
    market: businessUnitCode,
    businessUnitId: context.unit.id,
    organizationId: context.unit.organization_id,
    jurisdictionId: context.jurisdiction.id,
    jurisdictionCode: context.jurisdiction.code,
    configurationVersionId: configurationVersion.id,
    configurationVersion: configurationVersion.version,
    input: { dwellingType, beds, baths, packageKey, condition, frequency, sqft, addons },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });

  try {
    const quote = await calculatePublicBookingQuote(req.body || {});
    return res.status(200).json({ success: true, quote });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Unable to calculate booking quote.',
      code: error.code || 'BOOKING_QUOTE_ERROR',
    });
  }
}
