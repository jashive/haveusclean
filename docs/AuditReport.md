# HUC OS Refactor Audit Report

## Scope
Read-only audit of the current production codebase with emphasis on duplicated business logic, oversized components, direct database access, hard-coded values, and areas that should become shared engines or service layers.

## High-Level Assessment
The application is still centered on a very large monolithic `src/App.jsx` shell. Feature modules exist, but most business rules, pricing calculations, status mapping, validation flow, and direct data access still live in or are orchestrated from the app layer. The repo is functional, but the architecture is not yet modular enough for safe enterprise-scale expansion.

## Most Important Findings

### 1) `src/App.jsx` is the dominant architecture bottleneck
- File size is approximately 12.5k lines.
- It contains UI, quote calculation, status handling, Supabase access, email/API calls, local persistence, and multiple feature workflows.
- This file is the main source of coupling and the highest risk area for regressions.

### 2) Pricing logic is duplicated and partially centralized
- Pricing formulas live in `src/App.jsx` through `calcResQuote` and `calcComQuote`.
- Shared constants already exist in `src/lib/pricing.js`, but quote behavior is still orchestrated from the app layer.
- A quote gateway was added previously, but pricing still needs a fuller business-rules boundary if the goal is “one module for all pricing.”

### 3) Status handling is duplicated across domains
- Domain-specific status labels and checks are scattered across residential, cold outreach, and job flows.
- `src/lib/statusEngine.js` now centralizes canonical status mapping, but many components still rely on legacy domain labels and transition assumptions.
- Status transition validation is not yet a dedicated workflow layer.

### 4) Validation is too thin for the requested architecture
- `src/lib/leadValidation.js` only validates leads.
- There are no equivalent shared validators for quotes, bookings, invoices, customers, or work orders.
- Validation is embedded in workflow handlers instead of returning structured blocking issues and warnings.

### 5) Direct Supabase access is embedded in UI code
- `src/App.jsx` contains many direct `sbFetch` calls and persistence branches.
- Cold outreach persistence is especially complex and includes retry queue behavior in the UI layer.
- There is no repository/service pattern yet, so data access is duplicated and hard to test.

### 6) Oversized feature screens need extraction
- `src/pages/MySchedule.jsx` is ~1.6k lines.
- `src/features/leads/ColdOutreachView.jsx` is ~733 lines.
- `src/features/jobs/JobsView.jsx` is smaller but still a significant orchestration component.
- These are good candidates for extraction into feature-owned components, hooks, and services.

### 7) Dead or suspicious file paths exist
- There is a duplicate folder path with a trailing space: `src/components `.
- That folder contains a duplicate `StatusBadge.jsx`, which is likely accidental and should be reviewed for removal or consolidation.
- Build output files in `dist/` are present and should stay untracked.

### 8) Hard-coded domain values are still widespread
- Status labels, package names, service names, crew counts, tax rules, and quote defaults are still embedded throughout the app.
- These values should move into core constants, business rules, and feature-specific configuration.

## Current Architectural Strengths
- A shared status engine already exists and can be extended.
- Pricing constants are centralized in `src/lib/pricing.js`, which gives a good starting point for a pricing service.
- Existing feature modules such as `features/leads` and `features/jobs` provide a starting shape for domain ownership.
- The app is still stable enough to refactor incrementally if changes are kept additive.

## Recommended Phase Order
1. Business rules layer
2. Pricing engine consolidation
3. Validation engine
4. Status engine completion and transition validation
5. Service / repository layer for database access
6. Feature module extraction
7. Performance pass and mobile cleanup
8. Documentation and developer guide

## Primary Risks
- Any direct rewrite of `src/App.jsx` would be high-risk.
- Replacing legacy status labels too early could break existing user-facing workflows.
- Consolidating pricing without compatibility adapters could change quote totals.
- Moving Supabase calls without preserving payload shape could break sync and offline fallback behavior.

## Suggested Next Gate
Proceed with a small Phase 2 extraction that creates a reusable business-rules boundary while preserving all current output values and legacy labels.
