import { authenticatedRestFetch } from './serviceosAuthClient.js';
import {
  fetchPublishedGovernedResidentialConfig,
  getGovernedResidentialRequiredVersion,
} from './governedResidentialConfig.js';

async function parseJsonResponse(res, fallback) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error(data?.message || data?.error || fallback);
  return data;
}

function firstRow(value) {
  return Array.isArray(value) ? value[0] || null : null;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

export function deriveLegacySqftBand({ sqft, matrixSqftMax, explicitSqftBand } = {}) {
  if (explicitSqftBand) return explicitSqftBand;
  const actual = Number(sqft);
  const matrixMax = Number(matrixSqftMax);
  if (!Number.isFinite(actual) || !Number.isFinite(matrixMax) || actual <= matrixMax) return '';
  const delta = actual - matrixMax;
  if (delta <= 500) return 'additional_250_500_sqft';
  if (delta <= 1000) return 'additional_500_1000_sqft';
  return 'more_than_1000_sqft_above_typical';
}

export function buildRevisionSourceScope({ pricing, serviceRequest } = {}) {
  const rawInput = objectValue(pricing?.raw_calculation_snapshot?.input);
  const calculationInputs = objectValue(pricing?.calculation_inputs);
  const requirements = objectValue(serviceRequest?.requirements);
  const nestedScope = objectValue(requirements.scope);

  const sqft = firstDefined(
    rawInput.sqft,
    nestedScope.sqft,
    calculationInputs.sqft,
    calculationInputs.actual_sqft,
    requirements.sqft,
  );
  const sqftBand = deriveLegacySqftBand({
    sqft,
    matrixSqftMax: firstDefined(calculationInputs.matrix_sqft_max, rawInput.matrixSqftMax, nestedScope.matrixSqftMax),
    explicitSqftBand: firstDefined(rawInput.sqftBand, nestedScope.sqftBand, calculationInputs.sqftBand),
  });

  return {
    ...calculationInputs,
    ...requirements,
    ...nestedScope,
    ...rawInput,
    dwellingType: firstDefined(rawInput.dwellingType, nestedScope.dwellingType, requirements.dwellingType, requirements.dwelling_type),
    beds: firstDefined(rawInput.beds, nestedScope.beds, requirements.beds, requirements.bedrooms),
    baths: firstDefined(rawInput.baths, nestedScope.baths, requirements.baths, requirements.bathrooms),
    sqft: sqft !== undefined && sqft !== null && sqft !== '' ? Number(sqft) : null,
    packageKey: firstDefined(rawInput.packageKey, nestedScope.packageKey, requirements.packageKey),
    condition: firstDefined(rawInput.condition, nestedScope.condition, requirements.condition, 'light'),
    frequency: firstDefined(rawInput.frequency, nestedScope.frequency, requirements.frequency, 'one_time'),
    sqftBand,
    addons: Array.isArray(rawInput.addons)
      ? rawInput.addons
      : Array.isArray(nestedScope.addons)
        ? nestedScope.addons
        : Array.isArray(requirements.addons)
          ? requirements.addons
          : [],
  };
}

export async function listQuoteRevisionApprovers({ organizationId, businessUnitId, accessToken }) {
  const res = await authenticatedRestFetch('rpc/list_quote_revision_approvers', accessToken, {
    method: 'POST',
    body: JSON.stringify({ p_organization_id: organizationId, p_business_unit_id: businessUnitId }),
  });
  const data = await parseJsonResponse(res, 'Unable to load quote revision approvers.');
  return Array.isArray(data) ? data : [];
}

export async function createRevisedQuoteVersion({
  sourceQuoteVersionId,
  revisionType,
  revisionReason,
  approvedByAppUserId,
  concessionAmount = 0,
  estimateScopeSnapshot,
  estimateAssumptions,
  pricingSnapshot,
  title,
  lineItemsSnapshot,
  commercialSnapshot,
  metadata,
  accessToken,
}) {
  const res = await authenticatedRestFetch('rpc/create_revised_quote_version', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      p_source_quote_version_id: sourceQuoteVersionId,
      p_revision_type: revisionType,
      p_revision_reason: revisionReason || null,
      p_approved_by_app_user_id: approvedByAppUserId || null,
      p_concession_amount: Number(concessionAmount || 0),
      p_estimate_scope_snapshot: estimateScopeSnapshot || {},
      p_estimate_assumptions: estimateAssumptions || {},
      p_pricing_snapshot: pricingSnapshot || {},
      p_title: title || null,
      p_line_items_snapshot: lineItemsSnapshot || [],
      p_commercial_snapshot: commercialSnapshot || {},
      p_metadata: metadata || {},
    }),
  });
  return parseJsonResponse(res, 'Unable to create revised quote version.');
}

export async function loadQuoteRevisionSources({ organizationId, businessUnitId, accessToken }) {
  const qvRes = await authenticatedRestFetch(
    `quote_version?select=id,quote_id,estimate_id,pricing_snapshot_id,version_no,lifecycle_status,title,line_items_snapshot,commercial_snapshot,metadata,created_at&organization_id=eq.${encodeURIComponent(organizationId)}&business_unit_id=eq.${encodeURIComponent(businessUnitId)}&lifecycle_status=in.(draft,sent)&order=created_at.desc&limit=20`,
    accessToken
  );
  const versions = await parseJsonResponse(qvRes, 'Unable to load revisable quotes.');
  const rows = Array.isArray(versions) ? versions : [];
  const businessUnitPromiseCache = new Map();
  const activeConfigPromiseCache = new Map();

  async function loadBusinessUnit(codeBusinessUnitId) {
    if (!codeBusinessUnitId) return null;
    if (!businessUnitPromiseCache.has(codeBusinessUnitId)) {
      businessUnitPromiseCache.set(codeBusinessUnitId, (async () => {
        const res = await authenticatedRestFetch(
          `business_unit?select=id,code&id=eq.${encodeURIComponent(codeBusinessUnitId)}&limit=1`,
          accessToken
        );
        return firstRow(await parseJsonResponse(res, 'Unable to load quote business unit.'));
      })());
    }
    return businessUnitPromiseCache.get(codeBusinessUnitId);
  }

  async function loadActiveConfiguration({ canonicalBusinessUnitId, businessUnitCode, jurisdictionId }) {
    if (!canonicalBusinessUnitId || !businessUnitCode || !jurisdictionId) return null;
    const requiredVersion = getGovernedResidentialRequiredVersion(businessUnitCode);
    const cacheKey = `${canonicalBusinessUnitId}:${jurisdictionId}:${requiredVersion}`;
    if (!activeConfigPromiseCache.has(cacheKey)) {
      activeConfigPromiseCache.set(cacheKey, fetchPublishedGovernedResidentialConfig({
        accessToken,
        organizationId,
        businessUnitId: canonicalBusinessUnitId,
        jurisdictionId,
        requiredVersion,
      }));
    }
    return activeConfigPromiseCache.get(cacheKey);
  }

  return Promise.all(rows.map(async (version) => {
    const psRes = await authenticatedRestFetch(
      `pricing_snapshot?select=id,configuration_version_id,currency_code,tax_name,tax_rate,subtotal_amount,discount_amount,tax_amount,total_amount,calculator_version,configuration_snapshot,labor_economics,calculation_inputs,calculation_outputs,raw_calculation_snapshot,metadata&id=eq.${encodeURIComponent(version.pricing_snapshot_id)}&limit=1`,
      accessToken
    );
    const pricing = firstRow(await parseJsonResponse(psRes, 'Unable to load quote pricing snapshot.'));

    const quoteRes = await authenticatedRestFetch(
      `quote?select=id,opportunity_id,business_unit_id,service_location_id&id=eq.${encodeURIComponent(version.quote_id)}&limit=1`,
      accessToken
    );
    const quote = firstRow(await parseJsonResponse(quoteRes, 'Unable to load quote lineage.'));
    const opportunityId = quote?.opportunity_id || null;

    const oppRes = opportunityId ? await authenticatedRestFetch(
      `opportunity?select=id,service_request_id,business_unit_id,service_location_id&id=eq.${encodeURIComponent(opportunityId)}&limit=1`,
      accessToken
    ) : null;
    const opportunity = oppRes ? firstRow(await parseJsonResponse(oppRes, 'Unable to load quote opportunity.')) : null;
    const serviceRequestId = opportunity?.service_request_id || null;

    const estimateRes = version.estimate_id ? await authenticatedRestFetch(
      `estimate?select=id,business_unit_id,service_location_id&id=eq.${encodeURIComponent(version.estimate_id)}&limit=1`,
      accessToken
    ) : null;
    const estimate = estimateRes ? firstRow(await parseJsonResponse(estimateRes, 'Unable to load quote estimate lineage.')) : null;

    const srRes = serviceRequestId ? await authenticatedRestFetch(
      `service_request?select=id,title,requirements,business_unit_id,service_location_id&id=eq.${encodeURIComponent(serviceRequestId)}&limit=1`,
      accessToken
    ) : null;
    const serviceRequest = srRes ? firstRow(await parseJsonResponse(srRes, 'Unable to load quote customer.')) : null;

    const canonicalBusinessUnitId = firstDefined(
      quote?.business_unit_id,
      estimate?.business_unit_id,
      opportunity?.business_unit_id,
      serviceRequest?.business_unit_id,
    );
    if (canonicalBusinessUnitId && canonicalBusinessUnitId !== businessUnitId) {
      throw new Error('Quote revision lineage business unit does not match the active ServiceOS business unit.');
    }
    const businessUnit = await loadBusinessUnit(canonicalBusinessUnitId || businessUnitId);
    const businessUnitCode = businessUnit?.code || pricing?.configuration_snapshot?.business_unit_code || null;

    const serviceLocationId = firstDefined(
      quote?.service_location_id,
      estimate?.service_location_id,
      opportunity?.service_location_id,
      serviceRequest?.service_location_id,
    );
    const locationRes = serviceLocationId ? await authenticatedRestFetch(
      `service_location?select=id,jurisdiction_id&id=eq.${encodeURIComponent(serviceLocationId)}&limit=1`,
      accessToken
    ) : null;
    const serviceLocation = locationRes ? firstRow(await parseJsonResponse(locationRes, 'Unable to load quote service location.')) : null;
    const jurisdictionId = serviceLocation?.jurisdiction_id || pricing?.configuration_snapshot?.jurisdiction_id || null;

    let activeConfigurationVersion = null;
    let activeConfigurationError = null;
    try {
      activeConfigurationVersion = await loadActiveConfiguration({
        canonicalBusinessUnitId: canonicalBusinessUnitId || businessUnitId,
        businessUnitCode,
        jurisdictionId,
      });
    } catch (err) {
      activeConfigurationError = err?.message || 'Unable to resolve active governed residential configuration.';
    }

    return {
      ...version,
      pricing,
      serviceRequest,
      opportunity,
      estimate,
      serviceLocation,
      canonicalBusinessUnitId: canonicalBusinessUnitId || businessUnitId,
      businessUnitCode,
      jurisdictionId,
      canonicalCurrencyCode: activeConfigurationVersion?.configuration?.currency_code || pricing?.currency_code || null,
      activeConfigurationVersion,
      activeConfigurationError,
      customerName: serviceRequest?.requirements?.customer?.name || serviceRequest?.title || 'Customer',
      sourceScope: buildRevisionSourceScope({ pricing, serviceRequest }),
    };
  }));
}
