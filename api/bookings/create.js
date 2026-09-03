// Public booking intake endpoint.
// No customer account/password is required. All writes occur server-side through the
// canonical ServiceOS environment guard and service-role-only booking RPC.

import { requireServiceosServerTarget } from '../../src/server/serviceosServerEnvironment.js';
import { calculatePublicBookingQuote } from './quote.js';

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function text(value) {
  return String(value ?? '').trim();
}

function normalizeEmail(value) {
  return text(value).toLowerCase();
}

function normalizeMarket(value) {
  const token = text(value).toUpperCase();
  if (['ON', 'HUC-ON', 'ONTARIO'].includes(token)) return 'HUC-ON';
  if (['AZ', 'HUC-AZ', 'ARIZONA'].includes(token)) return 'HUC-AZ';
  throw httpError(400, 'Select Ontario or Arizona.', 'BOOKING_MARKET_INVALID');
}

function validatePostal(market, postalCode) {
  const value = text(postalCode).toUpperCase();
  if (market === 'HUC-ON' && !/^[A-Z]\d[A-Z][ -]?\d[A-Z]\d$/.test(value)) {
    throw httpError(400, 'Enter a valid Ontario postal code.', 'BOOKING_POSTAL_INVALID');
  }
  if (market === 'HUC-AZ' && !/^\d{5}(?:-\d{4})?$/.test(value)) {
    throw httpError(400, 'Enter a valid Arizona ZIP code.', 'BOOKING_POSTAL_INVALID');
  }
  return value;
}

function serverConfig() {
  requireServiceosServerTarget(process.env, {
    allowProduction: true,
    allowNonProduction: true,
    requireProductionApproval: true,
  });
  const url = text(process.env.SUPABASE_URL).replace(/\/$/, '');
  const secret = text(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!url || !secret) throw httpError(503, 'Public booking server configuration is incomplete.', 'BOOKING_SERVER_CONFIG_MISSING');
  return { url, secret };
}

async function callBookingRpc(payload, config) {
  const response = await fetch(`${config.url}/rest/v1/rpc/create_public_booking_intake`, {
    method: 'POST',
    headers: {
      apikey: config.secret,
      Authorization: `Bearer ${config.secret}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    console.error('Public booking RPC failed', { status: response.status, code: data?.code || null });
    throw httpError(502, 'Booking could not be saved. Please try again or contact Have Us Clean.', 'BOOKING_PERSISTENCE_FAILED');
  }
  return data;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed.' });

  try {
    const config = serverConfig();
    const booking = req.body?.bookingData || req.body || {};
    const name = text(booking.fullName || booking.name);
    const email = normalizeEmail(booking.email);
    const phone = text(booking.phone);
    const address = text(booking.address || booking.serviceAddress);
    const city = text(booking.city);
    const market = normalizeMarket(booking.market || booking.businessUnitCode);
    const postalCode = validatePostal(market, booking.postalCode || booking.zipCode);
    const requestedDate = text(booking.selectedDate || booking.date);
    const arrivalWindow = text(booking.selectedTimeSlot || booking.timeSlot);

    if (!name) throw httpError(400, 'Full name is required.', 'BOOKING_NAME_REQUIRED');
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'A valid email is required.', 'BOOKING_EMAIL_INVALID');
    if (!phone) throw httpError(400, 'Phone number is required.', 'BOOKING_PHONE_REQUIRED');
    if (!address || !city) throw httpError(400, 'Service address and city are required.', 'BOOKING_ADDRESS_REQUIRED');
    if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) throw httpError(400, 'Service date is required.', 'BOOKING_DATE_REQUIRED');
    if (!arrivalWindow) throw httpError(400, 'Arrival window is required.', 'BOOKING_WINDOW_REQUIRED');

    // Recalculate from published governed pricing on the server. Client totals are never trusted.
    const quote = await calculatePublicBookingQuote({
      market,
      dwellingType: booking.dwellingType,
      bedrooms: booking.bedrooms,
      bathrooms: booking.bathrooms,
      sqft: booking.sqft,
      packageKey: booking.packageKey,
      condition: booking.condition,
      frequency: booking.frequency,
      addons: booking.selectedAddOns || booking.selectedAddons || booking.addons || [],
    }, config);

    if (quote.requiresOfficeReview) {
      throw httpError(409, quote.reason || 'This request needs management review before booking.', 'BOOKING_REQUIRES_REVIEW');
    }

    const subdivision = market === 'HUC-ON' ? 'ON' : 'AZ';
    const countryCode = market === 'HUC-ON' ? 'CA' : 'US';
    const requirements = {
      bedrooms: Number(booking.bedrooms || 0),
      bathrooms: Number(booking.bathrooms || 0),
      sqft: booking.sqft === '' || booking.sqft == null ? null : Number(booking.sqft),
      dwelling_type: text(booking.dwellingType),
      package_key: text(booking.packageKey),
      condition: text(booking.condition || 'light'),
      frequency: text(booking.frequency || 'one_time'),
      addons: Array.isArray(quote.input?.addons) ? quote.input.addons : [],
      requested_service_date: requestedDate,
      requested_arrival_window: arrivalWindow,
      customer_notes: text(booking.notes),
    };

    const result = await callBookingRpc({
      p_organization_id: quote.organizationId,
      p_business_unit_id: quote.businessUnitId,
      p_jurisdiction_id: quote.jurisdictionId,
      p_display_name: name,
      p_email: email,
      p_phone: phone,
      p_address_line1: address,
      p_city: city,
      p_subdivision: subdivision,
      p_postal_code: postalCode,
      p_country_code: countryCode,
      p_requested_service_date: requestedDate,
      p_requested_arrival_window: arrivalWindow,
      p_service_package: text(booking.packageKey || 'essential_refresh'),
      p_frequency: text(booking.frequency || 'one_time'),
      p_currency_code: quote.currencyCode,
      p_tax_name: quote.taxName,
      p_tax_rate: Number(quote.taxRate || 0),
      p_estimated_subtotal: Number(quote.preTaxTotal || 0),
      p_estimated_tax: Number(quote.taxAmount || 0),
      p_estimated_total: Number(quote.total || 0),
      p_pricing_configuration_version_id: quote.configurationVersionId,
      p_requirements: requirements,
      p_pricing_snapshot: {
        authority: 'published_configuration_version',
        configuration_version_id: quote.configurationVersionId,
        configuration_version: quote.configurationVersion,
        market,
        currency_code: quote.currencyCode,
        tax_name: quote.taxName,
        tax_rate: Number(quote.taxRate || 0),
        subtotal: Number(quote.preTaxTotal || 0),
        tax_amount: Number(quote.taxAmount || 0),
        total: Number(quote.total || 0),
        input: quote.input || {},
      },
      p_metadata: {
        source: 'public_booking',
        customer_auth_created: false,
        public_route: '/book',
      },
    }, config);

    return res.status(201).json({
      success: true,
      bookingId: result?.booking_id || null,
      serviceRequestId: result?.service_request_id || null,
      customerId: result?.customer_id || null,
      quote: {
        market,
        currencyCode: quote.currencyCode,
        taxName: quote.taxName,
        taxRate: quote.taxRate,
        preTaxTotal: quote.preTaxTotal,
        taxAmount: quote.taxAmount,
        total: quote.total,
        configurationVersion: quote.configurationVersion,
      },
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message || 'Booking failed.',
      code: error.code || 'BOOKING_ERROR',
    });
  }
}
