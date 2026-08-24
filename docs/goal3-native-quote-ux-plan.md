# Goal 3 — Native Guided Intake + Quick Quote

Status: implementation branch

## Objective
Replace the synthetic Wave 2 pilot-facing Revenue experience with an office-safe production workflow for real residential leads.

## Canonical boundaries
- HEMS published residential configuration remains pricing authority.
- ServiceOS remains the operational system of record.
- Quote preparation may create service_request, opportunity, estimate, pricing_snapshot, quote and quote_version records.
- The UI must never fabricate customer acceptance, customer conversion, conversion_record or job_handoff.
- Quote sending is recorded only after an office operator explicitly confirms it was sent through the current approved channel.
- Hazard/extreme/unsupported scopes stop for management review.
- Wave 6 Intelligence remains disabled.

## Office flow
1. Capture customer/contact/location/scope facts.
2. Select residential package, condition and frequency.
3. Fetch the HEMS-published Ontario residential pricing configuration.
4. Generate a governed quote preview.
5. Copy the customer-facing quote text as needed.
6. Save a canonical draft or explicitly record the quote as sent.
7. Wait for real customer response before any acceptance/conversion/handoff action.

## Launch roles
- owner_admin
- office_ops

## Success criteria
- Jeanette/office operator can quote without using the Pricing Command Center workbook for ordinary in-matrix residential leads.
- All pricing comes from the published configuration version.
- Customer-facing subtotal, HST and total are visible before save.
- Scope and pricing evidence are frozen in the canonical pricing snapshot.
- No synthetic pilot data is created by the normal office workflow.
