import { authenticatedRestFetch } from './serviceosAuthClient.js';

async function parseJsonResponse(res, fallback) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new Error(data?.message || data?.error || fallback);
  return data;
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

  return Promise.all(rows.map(async (version) => {
    const psRes = await authenticatedRestFetch(
      `pricing_snapshot?select=id,configuration_version_id,currency_code,tax_name,tax_rate,subtotal_amount,discount_amount,tax_amount,total_amount,calculator_version,configuration_snapshot,labor_economics,calculation_inputs,calculation_outputs,raw_calculation_snapshot,metadata&id=eq.${encodeURIComponent(version.pricing_snapshot_id)}&limit=1`,
      accessToken
    );
    const pricingRows = await parseJsonResponse(psRes, 'Unable to load quote pricing snapshot.');
    const pricing = Array.isArray(pricingRows) ? pricingRows[0] : null;

    const quoteRes = await authenticatedRestFetch(`quote?select=id,opportunity_id&id=eq.${encodeURIComponent(version.quote_id)}&limit=1`, accessToken);
    const quoteRows = await parseJsonResponse(quoteRes, 'Unable to load quote lineage.');
    const opportunityId = Array.isArray(quoteRows) ? quoteRows[0]?.opportunity_id : null;

    const oppRes = opportunityId ? await authenticatedRestFetch(`opportunity?select=id,service_request_id&id=eq.${encodeURIComponent(opportunityId)}&limit=1`, accessToken) : null;
    const oppRows = oppRes ? await parseJsonResponse(oppRes, 'Unable to load quote opportunity.') : [];
    const serviceRequestId = Array.isArray(oppRows) ? oppRows[0]?.service_request_id : null;

    const srRes = serviceRequestId ? await authenticatedRestFetch(`service_request?select=id,title,requirements&id=eq.${encodeURIComponent(serviceRequestId)}&limit=1`, accessToken) : null;
    const srRows = srRes ? await parseJsonResponse(srRes, 'Unable to load quote customer.') : [];
    const serviceRequest = Array.isArray(srRows) ? srRows[0] : null;

    return {
      ...version,
      pricing,
      serviceRequest,
      customerName: serviceRequest?.requirements?.customer?.name || serviceRequest?.title || 'Customer',
      sourceScope: pricing?.raw_calculation_snapshot?.input || pricing?.calculation_inputs || serviceRequest?.requirements?.scope || {},
    };
  }));
}
