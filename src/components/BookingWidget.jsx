import React, { useMemo, useState } from 'react';

const MARKET_OPTIONS = [
  { value: 'HUC-ON', label: 'Ontario', regionLabel: 'Ontario postal code' },
  { value: 'HUC-AZ', label: 'Arizona', regionLabel: 'Arizona ZIP code' },
];

const PACKAGE_OPTIONS = [
  ['essential_refresh', 'Essential Refresh Clean'],
  ['signature_initial_reset', 'Signature Initial Reset Clean'],
  ['complete_deep', 'Complete Deep Clean'],
  ['move_in_move_out', 'Move-In / Move-Out Clean'],
  ['kitchen_bath_refresh', 'Kitchen & Bath Refresh Clean'],
  ['kitchen_bath_deep', 'Kitchen & Bath Deep Clean'],
];

const DWELLING_OPTIONS = [
  ['apartment', 'Apartment / Condo'],
  ['townhouse', 'Townhouse'],
  ['detached', 'Detached / Semi-Detached'],
];

const FREQUENCY_OPTIONS = [
  ['one_time', 'One-Time'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Biweekly'],
  ['monthly', 'Monthly'],
];

const ADDON_OPTIONS = [
  ['inside_refrigerator', 'Inside refrigerator'],
  ['inside_oven', 'Inside oven'],
  ['inside_kitchen_cabinets', 'Inside kitchen cabinets'],
  ['interior_windows', 'Interior windows'],
  ['pet_hair_removal', 'Pet hair removal'],
  ['heavy_baseboard_detailing', 'Heavy baseboard detailing'],
];

const styles = {
  shell: { width: '100%', maxWidth: 920, background: '#111827', color: '#F8FAFC', border: '1px solid #273449', borderRadius: 18, padding: 22, boxSizing: 'border-box' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 },
  label: { display: 'grid', gap: 6, fontSize: 13, fontWeight: 750, color: '#CBD5E1' },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid #3B4A60', borderRadius: 9, background: '#0B1220', color: '#F8FAFC', padding: '11px 12px', fontSize: 14 },
  section: { marginTop: 20, paddingTop: 18, borderTop: '1px solid #273449' },
  title: { margin: '0 0 12px', fontSize: 19 },
  addOns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 9 },
  addon: { display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #334155', borderRadius: 9, padding: 10, fontSize: 13 },
  actions: { display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 },
  primary: { border: 0, borderRadius: 9, background: '#22D3EE', color: '#06202A', padding: '11px 15px', fontWeight: 850, cursor: 'pointer' },
  confirm: { border: 0, borderRadius: 9, background: '#34D399', color: '#052E25', padding: '11px 15px', fontWeight: 850, cursor: 'pointer' },
  disabled: { opacity: 0.5, cursor: 'not-allowed' },
  quote: { marginTop: 16, background: '#0B1220', border: '1px solid #334155', borderRadius: 12, padding: 15 },
  money: { fontSize: 26, fontWeight: 900, marginTop: 5 },
  muted: { color: '#94A3B8', fontSize: 13, lineHeight: 1.5 },
  error: { color: '#FDA4AF', marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 13 },
};

function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(currency === 'CAD' ? 'en-CA' : 'en-US', {
      style: 'currency', currency: currency || 'USD',
    }).format(Number(amount || 0));
  } catch {
    return `${currency || ''} ${Number(amount || 0).toFixed(2)}`;
  }
}

export default function BookingWidget({ onBookingSubmit }) {
  const [form, setForm] = useState({
    market: 'HUC-ON',
    dwellingType: 'apartment',
    packageKey: 'essential_refresh',
    bedrooms: 1,
    bathrooms: 1,
    sqft: '',
    condition: 'light',
    frequency: 'one_time',
    fullName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    postalCode: '',
    selectedDate: '',
    selectedTimeSlot: '',
    notes: '',
  });
  const [selectedAddOns, setSelectedAddOns] = useState([]);
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const marketInfo = useMemo(() => MARKET_OPTIONS.find((item) => item.value === form.market) || MARKET_OPTIONS[0], [form.market]);

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
    setQuote(null);
    setError('');
  }

  function toggleAddon(id) {
    setSelectedAddOns((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
    setQuote(null);
    setError('');
  }

  async function calculateQuote() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/bookings/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market: form.market,
          dwellingType: form.dwellingType,
          packageKey: form.packageKey,
          bedrooms: Number(form.bedrooms),
          bathrooms: Number(form.bathrooms),
          sqft: form.sqft === '' ? null : Number(form.sqft),
          condition: form.condition,
          frequency: form.frequency,
          addons: selectedAddOns,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'Unable to calculate estimate.');
      if (result.quote?.requiresOfficeReview) throw new Error(result.quote.reason || 'This request needs management review.');
      setQuote(result.quote);
    } catch (err) {
      setQuote(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitBooking() {
    if (!quote || busy) return;
    setBusy(true);
    setError('');
    try {
      await onBookingSubmit?.({ ...form, selectedAddOns, governedQuote: quote });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={styles.shell} data-public-booking-widget="true">
      <h2 style={styles.title}>Tell us about your cleaning</h2>
      <div style={styles.grid}>
        <label style={styles.label}>Service market
          <select style={styles.input} value={form.market} onChange={(e) => update('market', e.target.value)}>
            {MARKET_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label style={styles.label}>Home type
          <select style={styles.input} value={form.dwellingType} onChange={(e) => update('dwellingType', e.target.value)}>
            {DWELLING_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label style={styles.label}>Cleaning package
          <select style={styles.input} value={form.packageKey} onChange={(e) => update('packageKey', e.target.value)}>
            {PACKAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label style={styles.label}>Frequency
          <select style={styles.input} value={form.frequency} onChange={(e) => update('frequency', e.target.value)}>
            {FREQUENCY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label style={styles.label}>Bedrooms
          <input style={styles.input} type="number" min="0" step="1" value={form.bedrooms} onChange={(e) => update('bedrooms', e.target.value)} />
        </label>
        <label style={styles.label}>Bathrooms
          <input style={styles.input} type="number" min="0.5" step="0.5" value={form.bathrooms} onChange={(e) => update('bathrooms', e.target.value)} />
        </label>
        <label style={styles.label}>Square footage (optional)
          <input style={styles.input} type="number" min="1" step="1" value={form.sqft} onChange={(e) => update('sqft', e.target.value)} placeholder="e.g. 1500" />
        </label>
        <label style={styles.label}>Condition
          <select style={styles.input} value={form.condition} onChange={(e) => update('condition', e.target.value)}>
            <option value="light">Light</option>
            <option value="moderate">Moderate</option>
            <option value="heavy">Heavy</option>
          </select>
        </label>
      </div>

      <div style={styles.section}>
        <h3 style={styles.title}>Optional add-ons</h3>
        <div style={styles.addOns}>
          {ADDON_OPTIONS.map(([id, label]) => (
            <label key={id} style={styles.addon}>
              <input type="checkbox" checked={selectedAddOns.includes(id)} onChange={() => toggleAddon(id)} /> {label}
            </label>
          ))}
        </div>
      </div>

      <div style={styles.actions}>
        <button type="button" style={{ ...styles.primary, ...(busy ? styles.disabled : {}) }} onClick={calculateQuote} disabled={busy}>
          {busy ? 'Calculating…' : 'Calculate governed estimate'}
        </button>
      </div>

      {quote ? (
        <div style={styles.quote} data-testid="public-booking-quote">
          <div style={styles.muted}>{quote.market} · {quote.configurationVersion}</div>
          <div style={styles.money}>{formatMoney(quote.total, quote.currencyCode)}</div>
          <div style={styles.muted}>
            Subtotal {formatMoney(quote.preTaxTotal, quote.currencyCode)} · {quote.taxName || 'Tax'} {Number(quote.taxRate || 0) * 100}% = {formatMoney(quote.taxAmount, quote.currencyCode)}
          </div>
        </div>
      ) : null}

      <div style={styles.section}>
        <h3 style={styles.title}>Contact & requested appointment</h3>
        <div style={styles.grid}>
          <label style={styles.label}>Full name<input style={styles.input} value={form.fullName} onChange={(e) => update('fullName', e.target.value)} /></label>
          <label style={styles.label}>Email<input style={styles.input} type="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></label>
          <label style={styles.label}>Phone<input style={styles.input} type="tel" value={form.phone} onChange={(e) => update('phone', e.target.value)} /></label>
          <label style={styles.label}>Street address<input style={styles.input} value={form.address} onChange={(e) => update('address', e.target.value)} /></label>
          <label style={styles.label}>City<input style={styles.input} value={form.city} onChange={(e) => update('city', e.target.value)} /></label>
          <label style={styles.label}>{marketInfo.regionLabel}<input style={styles.input} value={form.postalCode} onChange={(e) => update('postalCode', e.target.value)} placeholder={form.market === 'HUC-ON' ? 'A1A 1A1' : '85001'} /></label>
          <label style={styles.label}>Requested date<input style={styles.input} type="date" value={form.selectedDate} onChange={(e) => update('selectedDate', e.target.value)} /></label>
          <label style={styles.label}>Arrival window
            <select style={styles.input} value={form.selectedTimeSlot} onChange={(e) => update('selectedTimeSlot', e.target.value)}>
              <option value="">Select window</option>
              <option value="Morning">Morning</option>
              <option value="Midday">Midday</option>
              <option value="Afternoon">Afternoon</option>
              <option value="Flexible">Flexible</option>
            </select>
          </label>
        </div>
        <label style={{ ...styles.label, marginTop: 14 }}>Notes
          <textarea style={{ ...styles.input, minHeight: 90 }} value={form.notes} onChange={(e) => update('notes', e.target.value)} />
        </label>
      </div>

      <div style={styles.actions}>
        <button type="button" style={{ ...styles.confirm, ...((!quote || busy) ? styles.disabled : {}) }} onClick={submitBooking} disabled={!quote || busy}>
          Submit booking request
        </button>
      </div>
      <p style={{ ...styles.muted, marginBottom: 0 }}>No customer password is created. Your request enters Have Us Clean's ServiceOS intake queue for confirmation.</p>
      {error ? <div role="alert" style={styles.error}>{error}</div> : null}
    </section>
  );
}
