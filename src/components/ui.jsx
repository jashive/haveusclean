import React, { forwardRef } from 'react';

export const Button = forwardRef(function Button({ variant = 'primary', className = '', ...props }, ref) {
  return <button ref={ref} className={`huc-button huc-button--${variant} ${className}`.trim()} {...props} />;
});

export function FormField({ label, hint, error, className = '', children }) {
  return (
    <label className={`huc-field ${className}`.trim()}>
      <span className="huc-field__label">{label}</span>
      {children}
      {hint ? <span className="huc-field__hint">{hint}</span> : null}
      {error ? <span className="huc-field__error">{error}</span> : null}
    </label>
  );
}

export function SelectionTile({ selected = false, title, description, meta, className = '', ...props }) {
  return (
    <button type="button" aria-pressed={selected} className={`selection-tile ${selected ? 'is-selected' : ''} ${className}`.trim()} {...props}>
      <span className="selection-tile__check" aria-hidden="true">{selected ? '✓' : ''}</span>
      <span className="selection-tile__title">{title}</span>
      {description ? <span className="selection-tile__description">{description}</span> : null}
      {meta ? <span className="selection-tile__meta">{meta}</span> : null}
    </button>
  );
}

export function StatusBadge({ tone = 'neutral', children }) {
  return <span className={`status-badge status-badge--${tone}`}>{children}</span>;
}

export function StickySummaryCard({ eyebrow, title, children, footer }) {
  return (
    <aside className="sticky-summary-card" aria-label="Booking summary">
      {eyebrow ? <span className="summary-eyebrow">{eyebrow}</span> : null}
      <h2>{title}</h2>
      <div className="summary-content">{children}</div>
      {footer ? <div className="summary-footer">{footer}</div> : null}
    </aside>
  );
}
