import React, { useMemo, useState } from 'react';
import { Button, FormField, SelectionTile, StatusBadge, StickySummaryCard } from './ui';

const MARKETS = [
  { value: 'HUC-ON', title: 'Ontario', description: 'Greater Toronto Area', currency: 'CAD', tax: '13% HST', region: 'Postal code', placeholder: 'A1A 1A1' },
  { value: 'HUC-AZ', title: 'Arizona', description: 'Phoenix metro area', currency: 'USD', tax: 'Residential service tax rules applied', region: 'ZIP code', placeholder: '85001' },
];
const DWELLINGS = [['apartment', 'Apartment / Condo'], ['townhouse', 'Townhouse'], ['detached', 'Detached / Semi-Detached']];
const PACKAGES = [
  ['essential_refresh', 'Essential Refresh', 'A dependable maintenance clean.'],
  ['signature_initial_reset', 'Signature Initial Reset', 'A detailed first clean before recurring care.'],
  ['complete_deep', 'Complete Deep Clean', 'Our most thorough whole-home service.'],
  ['move_in_move_out', 'Move-In / Move-Out', 'An empty-home transition clean.'],
  ['kitchen_bath_refresh', 'Kitchen & Bath Refresh', 'Focused care for the busiest rooms.'],
  ['kitchen_bath_deep', 'Kitchen & Bath Deep', 'Detailed cleaning for kitchens and baths.'],
];
const FREQUENCIES = [['one_time', 'One-Time', 'Book one visit'], ['weekly', 'Weekly', 'Best ongoing care'], ['biweekly', 'Biweekly', 'Most popular'], ['monthly', 'Monthly', 'Monthly refresh']];
const COMMERCIAL_FREQUENCIES = [
  ['one_time', 'One-Time / Project'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Biweekly'],
  ['three_times_weekly', '3 Times Weekly'],
  ['five_times_weekly', '5 Times Weekly'],
  ['monthly', 'Monthly'],
  ['custom', 'Custom Schedule'],
];
const ADDONS = [['inside_refrigerator', 'Inside refrigerator'], ['inside_oven', 'Inside oven'], ['inside_kitchen_cabinets', 'Inside kitchen cabinets'], ['interior_windows', 'Interior windows'], ['pet_hair_removal', 'Pet hair removal'], ['heavy_baseboard_detailing', 'Heavy baseboard detailing']];
const STEPS = ['Location', 'Home Specs', 'Frequency & Tier', 'Add-ons', 'Schedule & Contact', 'Confirmation'];

const initialResidential = { market: 'HUC-ON', dwellingType: 'apartment', packageKey: 'essential_refresh', bedrooms: 1, bathrooms: 1, sqft: '', condition: 'light', frequency: 'one_time', fullName: '', email: '', phone: '', address: '', city: '', postalCode: '', selectedDate: '', selectedTimeSlot: '', notes: '' };
const initialCommercial = { market: 'HUC-ON', companyName: '', contactName: '', email: '', phone: '', address: '', city: '', postalCode: '', facilityType: 'office', estimatedSquareFeet: '', frequency: 'weekly', walkthroughDate: '', walkthroughTimeWindow: '', notes: '', idempotencyKey: makeIdempotencyKey('commercial-walkthrough') };

function formatMoney(amount, currency) {
  try { return new Intl.NumberFormat(currency === 'CAD' ? 'en-CA' : 'en-US', { style: 'currency', currency: currency || 'USD' }).format(Number(amount || 0)); }
  catch { return `${currency || ''} ${Number(amount || 0).toFixed(2)}`; }
}
function makeIdempotencyKey(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function StepIndicator({ current }) {
  return <nav className="booking-steps" aria-label="Booking progress"><ol>{STEPS.map((label, index) => <li key={label} className={index === current ? 'is-current' : index < current ? 'is-complete' : ''} aria-current={index === current ? 'step' : undefined}><span>{index < current ? '✓' : index + 1}</span><small>{label}</small></li>)}</ol></nav>;
}

function CommercialWalkthrough({ commercial, setCommercial, busy, error, status, onSubmit }) {
  const market = MARKETS.find((item) => item.value === commercial.market) || MARKETS[0];
  const update = (name, value) => setCommercial((current) => ({ ...current, [name]: value }));
  return <section className="commercial-intake" data-commercial-walkthrough="true">
    <div className="wizard-card__heading"><StatusBadge tone="info">Business services</StatusBadge><h2>Request a Commercial Facility Walkthrough</h2><p>We’ll assess your facility, access, frequency, and compliance needs before preparing a custom proposal.</p></div>
    <div className="commercial-notice"><strong>Custom Commercial Proposal — On-Site Facility Walkthrough Required</strong><span>No instant price or cleaning job is created.</span></div>
    <div className="form-grid">
      <FormField label="Service market"><select value={commercial.market} onChange={(e) => update('market', e.target.value)}>{MARKETS.map((item) => <option key={item.value} value={item.value}>{item.title}</option>)}</select></FormField>
      <FormField label="Company name"><input value={commercial.companyName} onChange={(e) => update('companyName', e.target.value)} /></FormField>
      <FormField label="Primary contact"><input value={commercial.contactName} onChange={(e) => update('contactName', e.target.value)} /></FormField>
      <FormField label="Email"><input type="email" value={commercial.email} onChange={(e) => update('email', e.target.value)} /></FormField>
      <FormField label="Phone"><input type="tel" value={commercial.phone} onChange={(e) => update('phone', e.target.value)} /></FormField>
      <FormField label="Service address"><input value={commercial.address} onChange={(e) => update('address', e.target.value)} /></FormField>
      <FormField label="City"><input value={commercial.city} onChange={(e) => update('city', e.target.value)} /></FormField>
      <FormField label={market.region}><input value={commercial.postalCode} placeholder={market.placeholder} onChange={(e) => update('postalCode', e.target.value)} /></FormField>
      <FormField label="Facility type"><select value={commercial.facilityType} onChange={(e) => update('facilityType', e.target.value)}><option value="office">Office</option><option value="medical">Medical / Dental</option><option value="retail">Retail</option><option value="industrial">Industrial / Warehouse Office</option></select></FormField>
      <FormField label="Estimated square footage"><input type="number" min="1" value={commercial.estimatedSquareFeet} onChange={(e) => update('estimatedSquareFeet', e.target.value)} /></FormField>
      <FormField label="Preferred cleaning frequency"><select value={commercial.frequency} onChange={(e) => update('frequency', e.target.value)}>{COMMERCIAL_FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      <FormField label="Preferred Walkthrough Date & Time Window"><input type="date" value={commercial.walkthroughDate} onChange={(e) => update('walkthroughDate', e.target.value)} /></FormField>
      <FormField label="Preferred time window"><select value={commercial.walkthroughTimeWindow} onChange={(e) => update('walkthroughTimeWindow', e.target.value)}><option value="">Select window</option><option>Morning</option><option>Midday</option><option>Afternoon</option><option>Flexible</option></select></FormField>
      <FormField label="Facility notes / access / requirements" className="form-grid__wide"><textarea value={commercial.notes} onChange={(e) => update('notes', e.target.value)} /></FormField>
    </div>
    <Button onClick={onSubmit} disabled={busy}>{busy ? 'Submitting…' : 'Request facility walkthrough'}</Button>
    {status ? <p role="status" className="form-message form-message--success">{status}</p> : null}{error ? <p role="alert" className="form-message form-message--error">{error}</p> : null}
  </section>;
}

export default function BookingWidget({ onBookingSubmit }) {
  const [mode, setMode] = useState('residential');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(initialResidential);
  const [commercial, setCommercial] = useState(initialCommercial);
  const [selectedAddOns, setSelectedAddOns] = useState([]);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [commercialStatus, setCommercialStatus] = useState('');
  const market = useMemo(() => MARKETS.find((item) => item.value === form.market) || MARKETS[0], [form.market]);
  const packageLabel = PACKAGES.find(([key]) => key === form.packageKey)?.[1];
  const frequencyLabel = FREQUENCIES.find(([key]) => key === form.frequency)?.[1];
  const update = (name, value) => { setForm((current) => ({ ...current, [name]: value })); setQuote(null); setError(''); };
  const toggleAddon = (id) => { setSelectedAddOns((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); setQuote(null); };

  async function calculateQuote() {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/bookings/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market: form.market, dwellingType: form.dwellingType, packageKey: form.packageKey, bedrooms: Number(form.bedrooms), bathrooms: Number(form.bathrooms), sqft: form.sqft === '' ? null : Number(form.sqft), condition: form.condition, frequency: form.frequency, addons: selectedAddOns }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'We could not calculate this estimate.');
      if (result.quote?.requiresOfficeReview) throw new Error(result.quote.reason || 'Our team needs to review this request.');
      // The server-returned configurationVersion remains part of the governed quote snapshot;
      // it is preserved for submission but intentionally not exposed as public diagnostic text.
      setQuote(result.quote); setStep(5);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'We could not calculate this estimate.'); }
    finally { setBusy(false); }
  }
  async function submitBooking() { if (!quote || busy) return; setBusy(true); setError(''); try { await onBookingSubmit?.({ ...form, selectedAddOns, governedQuote: quote }); } finally { setBusy(false); } }
  async function submitCommercial() {
    setBusy(true); setError(''); setCommercialStatus('');
    try { const response = await fetch('/api/bookings/commercial-walkthrough', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ walkthroughData: commercial }) }); const result = await response.json(); if (!response.ok || !result.success) throw new Error(result.error || 'We could not submit the walkthrough request.'); setCommercialStatus('Your request is in. Our estimating team will contact you to confirm the walkthrough.'); setCommercial((current) => ({ ...current, idempotencyKey: makeIdempotencyKey('commercial-walkthrough') })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'We could not submit the walkthrough request.'); } finally { setBusy(false); }
  }
  function continueStep() {
    if (step === 4) {
      const required = [form.fullName, form.email, form.phone, form.address, form.city, form.postalCode, form.selectedDate, form.selectedTimeSlot];
      if (required.some((value) => !String(value || '').trim())) { setError('Complete each required contact and scheduling field to continue.'); return; }
      if (!/^\S+@\S+\.\S+$/.test(form.email)) { setError('Enter a valid email address to continue.'); return; }
      calculateQuote(); return;
    }
    setStep((current) => Math.min(5, current + 1)); setError('');
  }

  const panels = [
    <div className="tile-grid tile-grid--two" key="location">{MARKETS.map((item) => <SelectionTile key={item.value} selected={form.market === item.value} title={item.title} description={item.description} meta={`${item.currency} · ${item.tax}`} onClick={() => update('market', item.value)} />)}</div>,
    <div className="wizard-stack" key="home"><div className="tile-grid tile-grid--three">{DWELLINGS.map(([value, title]) => <SelectionTile key={value} selected={form.dwellingType === value} title={title} onClick={() => update('dwellingType', value)} />)}</div><div className="form-grid"><FormField label="Bedrooms"><input type="number" min="0" step="1" value={form.bedrooms} onChange={(e) => update('bedrooms', e.target.value)} /></FormField><FormField label="Bathrooms"><input type="number" min="0.5" step="0.5" value={form.bathrooms} onChange={(e) => update('bathrooms', e.target.value)} /></FormField><FormField label="Square footage" hint="Optional"><input type="number" min="1" value={form.sqft} onChange={(e) => update('sqft', e.target.value)} /></FormField><FormField label="Current condition"><select value={form.condition} onChange={(e) => update('condition', e.target.value)}><option value="light">Light upkeep</option><option value="moderate">Needs extra attention</option><option value="heavy">Heavy buildup</option></select></FormField></div></div>,
    <div className="wizard-stack" key="service"><h3>Choose your cleaning tier</h3><div className="tile-grid tile-grid--two">{PACKAGES.map(([value, title, description]) => <SelectionTile key={value} selected={form.packageKey === value} title={title} description={description} onClick={() => update('packageKey', value)} />)}</div><h3>How often should we visit?</h3><div className="tile-grid tile-grid--four">{FREQUENCIES.map(([value, title, meta]) => <SelectionTile key={value} selected={form.frequency === value} title={title} meta={meta} onClick={() => update('frequency', value)} />)}</div></div>,
    <div className="tile-grid tile-grid--two" key="addons">{ADDONS.map(([value, title]) => <SelectionTile key={value} selected={selectedAddOns.includes(value)} title={title} description="Add to this cleaning" onClick={() => toggleAddon(value)} />)}</div>,
    <div className="form-grid" key="contact"><FormField label="Full name"><input autoComplete="name" value={form.fullName} onChange={(e) => update('fullName', e.target.value)} /></FormField><FormField label="Email"><input type="email" autoComplete="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></FormField><FormField label="Phone"><input type="tel" autoComplete="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} /></FormField><FormField label="Street address"><input autoComplete="street-address" value={form.address} onChange={(e) => update('address', e.target.value)} /></FormField><FormField label="City"><input value={form.city} onChange={(e) => update('city', e.target.value)} /></FormField><FormField label={market.region}><input value={form.postalCode} placeholder={market.placeholder} onChange={(e) => update('postalCode', e.target.value)} /></FormField><FormField label="Requested date"><input type="date" value={form.selectedDate} onChange={(e) => update('selectedDate', e.target.value)} /></FormField><FormField label="Arrival window"><select value={form.selectedTimeSlot} onChange={(e) => update('selectedTimeSlot', e.target.value)}><option value="">Select window</option><option>Morning</option><option>Midday</option><option>Afternoon</option><option>Flexible</option></select></FormField><FormField label="Anything else we should know?" className="form-grid__wide"><textarea value={form.notes} onChange={(e) => update('notes', e.target.value)} /></FormField></div>,
    <div className="confirmation-panel" key="confirmation"><StatusBadge tone={quote ? 'success' : 'warning'}>{quote ? 'Estimate ready' : 'Estimate needed'}</StatusBadge><h3>{quote ? 'Review your estimate' : 'Let’s calculate your estimate'}</h3><p>{quote ? 'Your selections and governed regional pricing are ready for your final review.' : 'Return to your details and calculate the governed estimate.'}</p>{quote ? <div className="confirmation-total" data-testid="public-booking-quote"><span>Total</span><strong>{formatMoney(quote.total, quote.currencyCode)}</strong><small>Subtotal {formatMoney(quote.preTaxTotal, quote.currencyCode)} · {quote.taxName || 'Tax'} {Number(quote.taxRate || 0) * 100}% = {formatMoney(quote.taxAmount, quote.currencyCode)}</small></div> : null}</div>,
  ];

  return <section className="booking-experience" data-public-booking-widget="true">
    <div className="service-mode" aria-label="Service type"><Button variant={mode === 'residential' ? 'primary' : 'ghost'} aria-pressed={mode === 'residential'} onClick={() => { setMode('residential'); setError(''); }}>Residential Cleaning</Button><Button variant={mode === 'commercial' ? 'primary' : 'ghost'} aria-pressed={mode === 'commercial'} onClick={() => { setMode('commercial'); setError(''); }}>Commercial Cleaning</Button></div>
    {mode === 'commercial' ? <CommercialWalkthrough commercial={commercial} setCommercial={setCommercial} busy={busy} error={error} status={commercialStatus} onSubmit={submitCommercial} /> : <>
      <StepIndicator current={step} />
      <div className="booking-layout" data-residential-booking="true">
        <section className="wizard-card" aria-labelledby="wizard-title"><div className="wizard-card__heading"><span className="wizard-step-label">Step {step + 1} of {STEPS.length}</span><h2 id="wizard-title">{STEPS[step]}</h2><p>{['Where will we be cleaning?', 'Tell us about the home.', 'Choose the right service and rhythm.', 'Personalize your clean.', 'Choose a time and tell us how to reach you.', 'Review everything before sending.'][step]}</p></div>{panels[step]}{error ? <p role="alert" className="form-message form-message--error">{error}</p> : null}<div className="wizard-actions">{step > 0 ? <Button variant="secondary" onClick={() => setStep((current) => current - 1)} disabled={busy}>Back</Button> : <span />}{step < 5 ? <Button onClick={continueStep} disabled={busy}>{step === 4 ? (busy ? 'Calculating…' : 'Calculate estimate') : 'Continue'}</Button> : <Button onClick={submitBooking} disabled={!quote || busy}>{busy ? 'Submitting…' : 'Submit booking request'}</Button>}</div></section>
        <StickySummaryCard eyebrow={`${market.title} · ${market.currency}`} title="Your cleaning"><dl><div><dt>Home</dt><dd>{DWELLINGS.find(([key]) => key === form.dwellingType)?.[1]}</dd></div><div><dt>Service</dt><dd>{packageLabel}</dd></div><div><dt>Frequency</dt><dd>{frequencyLabel}</dd></div><div><dt>Add-ons</dt><dd>{selectedAddOns.length || 'None'}</dd></div></dl>{quote ? <div className="summary-total"><span>Estimated total</span><strong>{formatMoney(quote.total, quote.currencyCode)}</strong><small>{quote.taxName || 'Tax'} included: {formatMoney(quote.taxAmount, quote.currencyCode)}</small></div> : <div className="summary-pending">Your governed estimate appears after your details are complete.</div>}<div className="summary-assurance"><span aria-hidden="true">✓</span> Pricing and tax rules are applied by region.</div></StickySummaryCard>
      </div>
    </>}
  </section>;
}
