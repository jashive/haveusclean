import React, { useEffect, useMemo, useState } from 'react';
import {
  createRevisedQuoteVersion,
  listQuoteRevisionApprovers,
  loadQuoteRevisionSources,
} from '../../lib/serviceosQuoteRevisionClient.js';
import {
  computeGovernedResidentialQuote,
} from '../../lib/governedResidentialPricing.js';
import {
  OFFICE_ADDON_OPTIONS,
  applyGovernedResidentialAddons,
  buildCustomerFacingQuoteText,
  formatQuoteMoney,
  getDefaultApprovedSelections,
  getManagementReviewReason,
  isAddonBundledForPackage,
  removeBundledAddonsForPackage,
} from '../../lib/serviceosOfficeQuoteUtils.js';

const PACKAGE_OPTIONS = [
  { value: 'essential_refresh', label: 'Essential Refresh Clean' },
  { value: 'kitchen_bath_refresh', label: 'Kitchen & Bath Refresh Clean' },
  { value: 'signature_initial_reset', label: 'Signature Initial Reset Clean' },
  { value: 'complete_deep', label: 'Complete Deep Clean' },
  { value: 'kitchen_bath_deep', label: 'Kitchen & Bath Deep Clean' },
  { value: 'move_in_move_out', label: 'Move-In / Move-Out Clean' },
];

const styles = {
  panel: { background: '#151D2C', border: '1px solid #28364A', borderRadius: 12, padding: 18, marginBottom: 14, color: '#F5F8FC' },
  sub: { color: '#AEBAC9', fontSize: 13, lineHeight: 1.5 },
  card: { background: '#0E1524', border: '1px solid #2A394E', borderRadius: 10, padding: 15, marginTop: 12 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 10, marginTop: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { color: '#AEBAC9', fontSize: 12, fontWeight: 750 },
  input: { border: '1px solid #3A4B62', borderRadius: 8, background: '#111B2B', color: '#F5F8FC', padding: '9px 10px', fontSize: 13 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 },
  primary: { border: 0, borderRadius: 8, padding: '10px 14px', background: '#00D4AA', color: '#07110F', fontWeight: 850, cursor: 'pointer' },
  secondary: { border: '1px solid #52637A', borderRadius: 8, padding: '9px 13px', background: '#151D2C', color: '#F5F8FC', fontWeight: 800, cursor: 'pointer' },
  warning: { marginTop: 10, padding: 10, borderRadius: 8, background: '#3B3218', color: '#F1D986', fontSize: 13 },
  error: { marginTop: 10, padding: 10, borderRadius: 8, background: '#421E26', color: '#FFB3C0', fontSize: 13 },
  success: { marginTop: 10, padding: 10, borderRadius: 8, background: '#18392F', color: '#8EF1D8', fontSize: 13 },
  quote: { whiteSpace: 'pre-wrap', background: '#111B2B', border: '1px solid #26364C', borderRadius: 8, padding: 10, marginTop: 10, fontSize: 12, lineHeight: 1.5 },
};

function packageLabel(key) { return PACKAGE_OPTIONS.find((item) => item.value === key)?.label || key; }
function money(value) { return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100; }

function configurationVersionFromSnapshot(pricing) {
  const snapshot = pricing?.configuration_snapshot || {};
  return {
    id: pricing?.configuration_version_id,
    business_unit_id: snapshot.business_unit_id,
    jurisdiction_id: snapshot.jurisdiction_id,
    configuration_type: snapshot.configuration_type || 'residential_pricing',
    version: snapshot.version,
    effective_from: snapshot.effective_from,
    effective_to: snapshot.effective_to,
    configuration: snapshot,
  };
}

function pricingPayloadFromQuote({ sourcePricing, quote, revisionType, revisionReason, concessionAmount }) {
  return {
    configuration_version_id: sourcePricing.configuration_version_id,
    currency_code: quote.currencyCode || sourcePricing.currency_code,
    tax_name: quote.taxName || sourcePricing.tax_name,
    tax_rate: Number(quote.taxRate ?? sourcePricing.tax_rate ?? 0),
    subtotal_amount: money(quote.preTaxTotal),
    discount_amount: money((Number(sourcePricing.discount_amount || 0)) + Number(concessionAmount || 0)),
    tax_amount: money(quote.taxAmount),
    total_amount: money(quote.total),
    calculator_version: `${sourcePricing.calculator_version || '2.1'}-revision`,
    configuration_snapshot: sourcePricing.configuration_snapshot || {},
    labor_economics: sourcePricing.labor_economics || {},
    calculation_inputs: quote.input || sourcePricing.calculation_inputs || {},
    calculation_outputs: {
      preTaxTotal: money(quote.preTaxTotal),
      taxAmount: money(quote.taxAmount),
      taxRate: Number(quote.taxRate ?? sourcePricing.tax_rate ?? 0),
      total: money(quote.total),
      discountAmount: money((Number(sourcePricing.discount_amount || 0)) + Number(concessionAmount || 0)),
      currency: quote.currencyCode || sourcePricing.currency_code,
    },
    raw_calculation_snapshot: {
      ...quote,
      revisionType,
      revisionReason: revisionReason || null,
      sourcePricingSnapshotId: sourcePricing.id,
    },
    metadata: { revision_type: revisionType, revision_reason: revisionReason || null },
  };
}

export default function ServiceOSQuoteRevisionPanel({ session, revenueContext }) {
  const token = session?.access_token || null;
  const organizationId = revenueContext?.orgId || null;
  const businessUnitId = revenueContext?.primaryBusinessUnitId || null;
  const [rows, setRows] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [revisionType, setRevisionType] = useState('scope_adjustment');
  const [scopeMode, setScopeMode] = useState('full_home');
  const [packageKey, setPackageKey] = useState('essential_refresh');
  const [addons, setAddons] = useState([]);
  const [partialAreas, setPartialAreas] = useState('');
  const [partialSubtotal, setPartialSubtotal] = useState('');
  const [reason, setReason] = useState('');
  const [approvedBy, setApprovedBy] = useState('');
  const [concessionAmount, setConcessionAmount] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId]);
  const selectedConfigVersion = selected?.pricing ? configurationVersionFromSnapshot(selected.pricing) : null;

  async function refresh() {
    if (!token || !organizationId || !businessUnitId) return;
    setError('');
    try {
      const [sourceRows, approverRows] = await Promise.all([
        loadQuoteRevisionSources({ organizationId, businessUnitId, accessToken: token }),
        listQuoteRevisionApprovers({ organizationId, businessUnitId, accessToken: token }),
      ]);
      setRows(sourceRows);
      setApprovers(approverRows);
      if (sourceRows.length && !sourceRows.some((row) => row.id === selectedId)) setSelectedId(sourceRows[0].id);
    } catch (err) { setError(err?.message || 'Unable to load quote revision workflow.'); }
  }

  useEffect(() => { refresh(); }, [token, organizationId, businessUnitId]);
  useEffect(() => {
    if (!selected) return;
    const source = selected.sourceScope || {};
    setPackageKey(source.packageKey || 'essential_refresh');
    setAddons(Array.isArray(source.addons) ? source.addons : []);
    setPartialAreas(''); setPartialSubtotal(''); setReason(''); setApprovedBy(''); setConcessionAmount(''); setPreview(null);
  }, [selectedId]);

  function selectPackage(nextPackageKey) {
    setPackageKey(nextPackageKey);
    setAddons((current) => removeBundledAddonsForPackage({ packageKey: nextPackageKey, addons: current, configurationVersion: selectedConfigVersion }));
    setPreview(null);
  }

  function toggleAddon(id) {
    if (isAddonBundledForPackage({ packageKey, addonId: id, configurationVersion: selectedConfigVersion })) return;
    setAddons((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setPreview(null);
  }

  function buildPreview() {
    if (!selected?.pricing) throw new Error('Select an active quote version to revise.');
    const sourcePricing = selected.pricing;
    const sourceScope = selected.sourceScope || {};
    const configVersion = configurationVersionFromSnapshot(sourcePricing);
    const config = configVersion.configuration || {};

    if (revisionType === 'approved_concession') {
      const amount = Number(concessionAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive concession amount.');
      if (!reason.trim()) throw new Error('Approved concession requires a Reason.');
      if (!approvedBy) throw new Error('Approved concession requires Approved By.');
      const sourceSubtotal = Number(sourcePricing.subtotal_amount || 0);
      if (amount >= sourceSubtotal) throw new Error('Concession must be less than the current pre-tax subtotal.');
      const preTaxTotal = money(sourceSubtotal - amount);
      const taxRate = Number(sourcePricing.tax_rate || 0);
      const taxAmount = money(preTaxTotal * taxRate);
      return {
        quote: {
          preTaxTotal, taxRate, taxAmount, total: money(preTaxTotal + taxAmount),
          taxName: sourcePricing.tax_name, currencyCode: sourcePricing.currency_code,
          input: { ...sourceScope, addons: sourceScope.addons || [] },
          addonLines: selected.line_items_snapshot?.[0]?.addons || [],
        },
        title: selected.title,
        scope: sourceScope,
        customerText: `${selected.commercial_snapshot?.customerFacingText || ''}\n\nREVISED PRICE: ${formatQuoteMoney(preTaxTotal, sourcePricing.currency_code)}${taxRate > 0 ? ` + ${sourcePricing.tax_name}` : ''}. This revision reflects an approved pricing concession; the service scope remains unchanged.`,
        concessionAmount: amount,
      };
    }

    if (scopeMode === 'partial_home') {
      if (!partialAreas.trim()) throw new Error('Describe the areas included in the revised partial-home scope.');
      const requestedSubtotal = Number(partialSubtotal);
      if (!Number.isFinite(requestedSubtotal) || requestedSubtotal <= 0) throw new Error('Enter the revised partial-home pre-tax price.');
      const partialRule = config.partial_cleaning || {};
      const minimum = Number(partialRule.minimum_charge ?? config.minimum_charge?.partial_cleaning ?? 0);
      if (minimum > 0 && requestedSubtotal < minimum) throw new Error(`Partial-home scope cannot be quoted below ${formatQuoteMoney(minimum, sourcePricing.currency_code)} without an Approved Concession.`);
      const taxRate = Number(sourcePricing.tax_rate || 0);
      const preTaxTotal = money(requestedSubtotal);
      const taxAmount = money(preTaxTotal * taxRate);
      const quote = {
        preTaxTotal, taxRate, taxAmount, total: money(preTaxTotal + taxAmount),
        taxName: sourcePricing.tax_name, currencyCode: sourcePricing.currency_code,
        input: { ...sourceScope, scopeMode: 'partial_home', partialAreas: partialAreas.trim(), addons },
        addonLines: [],
      };
      return {
        quote,
        title: 'Partial Home Cleaning',
        scope: quote.input,
        customerText: `Hi ${String(selected.customerName || 'there').split(/\s+/)[0]},\n\nWe revised your Have Us Clean quote to fit the requested scope. Included areas: ${partialAreas.trim()}.\n\nRevised price: ${formatQuoteMoney(preTaxTotal, sourcePricing.currency_code)}${taxRate > 0 ? ` + ${sourcePricing.tax_name}, total ${formatQuoteMoney(quote.total, sourcePricing.currency_code)}` : ` total`}.\n\nThis revised quote replaces the prior version.`,
        concessionAmount: 0,
      };
    }

    const review = getManagementReviewReason({ condition: sourceScope.condition, notes: selected.serviceRequest?.requirements?.scope?.notes || '', packageKey, addons, configurationVersion: configVersion });
    if (review) throw new Error(review);
    const approvedSelections = getDefaultApprovedSelections(configVersion, { condition: sourceScope.condition || 'light', frequency: sourceScope.frequency || 'one_time', sqftBand: sourceScope.sqftBand || '' });
    const raw = computeGovernedResidentialQuote({
      configurationVersion: configVersion,
      dwellingType: sourceScope.dwellingType,
      beds: Number(sourceScope.beds || 0),
      baths: Number(sourceScope.baths),
      packageKey,
      condition: sourceScope.condition || 'light',
      frequency: sourceScope.frequency || 'one_time',
      addons,
      approvedSelections,
    });
    if (raw?.requiresOfficeReview) throw new Error(raw.reason || 'Revised scope requires management review.');
    const quote = applyGovernedResidentialAddons(raw, configVersion, addons);
    quote.input = { ...sourceScope, packageKey, addons };
    return {
      quote,
      title: packageLabel(packageKey),
      scope: quote.input,
      customerText: buildCustomerFacingQuoteText({ customerName: selected.customerName, serviceLabel: packageLabel(packageKey), quote, frequencyLabel: sourceScope.frequency || 'One-Time' }) + '\n\nThis revised quote replaces the prior version.',
      concessionAmount: 0,
    };
  }

  function handlePreview() {
    setError(''); setNotice('');
    try { setPreview(buildPreview()); } catch (err) { setPreview(null); setError(err?.message || 'Unable to calculate revised quote.'); }
  }

  async function handleCreateRevision() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = preview || buildPreview();
      const sourcePricing = selected.pricing;
      const result = await createRevisedQuoteVersion({
        sourceQuoteVersionId: selected.id,
        revisionType,
        revisionReason: reason.trim() || (scopeMode === 'partial_home' ? `Budget-fit partial scope: ${partialAreas.trim()}` : `Scope revised to ${next.title}`),
        approvedByAppUserId: revisionType === 'approved_concession' ? approvedBy : null,
        concessionAmount: next.concessionAmount,
        estimateScopeSnapshot: next.scope,
        estimateAssumptions: { pricing_authority: sourcePricing.configuration_snapshot?.version || null, pricing_mode: 'governed_quote_revision', source_quote_version_id: selected.id },
        pricingSnapshot: pricingPayloadFromQuote({ sourcePricing, quote: next.quote, revisionType, revisionReason: reason.trim(), concessionAmount: next.concessionAmount }),
        title: next.title,
        lineItemsSnapshot: [{ service: next.title, subtotal: next.quote.preTaxTotal, tax: next.quote.taxAmount, total: next.quote.total, currency_code: next.quote.currencyCode, tax_name: next.quote.taxName, addons: next.quote.addonLines || [], scope: next.scope }],
        commercialSnapshot: { customerFacingText: next.customerText, revision_of_quote_version_id: selected.id },
        metadata: { source: 'serviceos_quote_revision', scope_mode: revisionType === 'scope_adjustment' ? scopeMode : 'unchanged' },
        accessToken: token,
      });
      setNotice(`Quote V${result.version_no} created as the active draft. Quote V${selected.version_no} is now Superseded. Use Quote Delivery above to email the new canonical version.`);
      setPreview(null);
      await refresh();
    } catch (err) { setError(err?.message || 'Unable to create revised quote.'); }
    finally { setBusy(false); }
  }

  return (
    <section style={styles.panel} data-testid="serviceos-quote-revision-panel">
      <h2 style={{ margin: 0, fontSize: 19 }}>Governed Quote Revision + Budget Fit</h2>
      <p style={styles.sub}>Revise an active quote without re-entering customer information. ServiceOS creates a new version and preserves the original as <strong>Superseded</strong>. Never overwrite a sent quote.</p>
      {notice ? <div style={styles.success}>{notice}</div> : null}
      {error ? <div style={styles.error}>{error}</div> : null}
      <div style={styles.grid}>
        <label style={styles.field}><span style={styles.label}>Quote to revise</span><select style={styles.input} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value="">Select quote</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.customerName} — V{row.version_no} — {row.title || 'Quote'} — {row.lifecycle_status}</option>)}</select></label>
        <label style={styles.field}><span style={styles.label}>Revision type</span><select style={styles.input} value={revisionType} onChange={(e) => { setRevisionType(e.target.value); setPreview(null); }}><option value="scope_adjustment">Scope Adjustment</option><option value="approved_concession">Approved Concession</option></select></label>
      </div>

      {selected ? <div style={styles.card}>
        <strong>{selected.customerName} — Quote V{selected.version_no}</strong>
        <div style={styles.sub}>Current pre-tax: {formatQuoteMoney(selected.pricing?.subtotal_amount, selected.pricing?.currency_code)} · Total: {formatQuoteMoney(selected.pricing?.total_amount, selected.pricing?.currency_code)}</div>

        {revisionType === 'scope_adjustment' ? <>
          <div style={styles.grid}>
            <label style={styles.field}><span style={styles.label}>Scope path</span><select style={styles.input} value={scopeMode} onChange={(e) => { setScopeMode(e.target.value); setPreview(null); }}><option value="full_home">Package / Add-on Revision</option><option value="partial_home">Partial Home / Selected Areas</option></select></label>
            {scopeMode === 'full_home' ? <label style={styles.field}><span style={styles.label}>Service tier</span><select style={styles.input} value={packageKey} onChange={(e) => selectPackage(e.target.value)}>{PACKAGE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
          </div>
          {scopeMode === 'full_home' ? <div style={styles.grid}>{OFFICE_ADDON_OPTIONS.map((item) => {
            const bundled = isAddonBundledForPackage({ packageKey, addonId: item.id, configurationVersion: selectedConfigVersion });
            return <label key={item.id} style={{ ...styles.field, flexDirection: 'row', alignItems: 'center', ...(bundled ? { opacity: 0.48 } : {}) }} title={bundled ? 'Included in selected package — no additional charge' : undefined}><input type="checkbox" checked={addons.includes(item.id)} disabled={bundled} onChange={() => toggleAddon(item.id)} /> <span>{item.label}{bundled ? ' — Included' : ''}</span></label>;
          })}</div> : <div style={styles.grid}>
            <label style={styles.field}><span style={styles.label}>Areas included</span><textarea style={styles.input} rows={3} value={partialAreas} onChange={(e) => { setPartialAreas(e.target.value); setPreview(null); }} placeholder="Kitchen, bathrooms, floors, main level..." /></label>
            <label style={styles.field}><span style={styles.label}>Governed partial pre-tax price</span><input style={styles.input} type="number" min="0" step="5" value={partialSubtotal} onChange={(e) => { setPartialSubtotal(e.target.value); setPreview(null); }} /><span style={styles.sub}>HEMS partial-clean minimum is enforced from the frozen configuration. Below-minimum pricing requires Approved Concession.</span></label>
          </div>}
        </> : <div style={styles.grid}>
          <label style={styles.field}><span style={styles.label}>Concession amount (pre-tax)</span><input style={styles.input} type="number" min="0" step="5" value={concessionAmount} onChange={(e) => { setConcessionAmount(e.target.value); setPreview(null); }} /></label>
          <label style={styles.field}><span style={styles.label}>Reason (required)</span><input style={styles.input} value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder="Customer budget / retention / approved closing concession" /></label>
          <label style={styles.field}><span style={styles.label}>Approved By (required owner/admin)</span><select style={styles.input} value={approvedBy} onChange={(e) => { setApprovedBy(e.target.value); setPreview(null); }}><option value="">Select approver</option>{approvers.map((item) => <option key={item.app_user_id} value={item.app_user_id}>{item.display_name || item.email}</option>)}</select></label>
        </div>}

        <div style={styles.actions}><button type="button" style={styles.secondary} onClick={handlePreview}>Preview Revision</button><button type="button" style={styles.primary} onClick={handleCreateRevision} disabled={busy}>{busy ? 'Creating…' : 'Create Revised Quote Version'}</button></div>
        {preview ? <div style={styles.quote}><strong>Preview — {preview.title}</strong><br />Pre-tax: {formatQuoteMoney(preview.quote.preTaxTotal, preview.quote.currencyCode)}<br />Tax: {formatQuoteMoney(preview.quote.taxAmount, preview.quote.currencyCode)}<br />Total: {formatQuoteMoney(preview.quote.total, preview.quote.currencyCode)}<br /><br />{preview.customerText}</div> : null}
      </div> : <div style={styles.warning}>No active draft/sent quote selected.</div>}
      <p style={styles.sub}>Delivery rule: the revised version starts as Draft. Emailing it through ServiceOS creates a new secure customer decision link for that exact version. The superseded version cannot be newly accepted.</p>
    </section>
  );
}
