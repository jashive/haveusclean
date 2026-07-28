# Developer Guide

## Purpose

This repo is being refactored from a monolithic app shell toward a feature-driven UI layer backed by a `src/core/` logic boundary. The current priority is to keep behavior stable while moving business logic, validation, pricing, and integrations out of `src/App.jsx`.

## Current Shape

UI ownership:
- `src/App.jsx`: still the main shell/router and high-level orchestration layer
- `src/features/`: feature-owned UI and workflow slices
- `src/pages/`: large screen-level pages that are candidates for future extraction

Core ownership:
- `src/core/businessRules/`: lead normalization and merge rules
- `src/core/repositories/`: Supabase REST boundaries
- `src/core/validation/`: shared validation engine
- `src/core/*`: scaffolded directories for the next extraction passes

## Core Directory Map

`src/core/`

- `businessRules/`: normalize, merge, and infer domain records
- `pricing/`: quote and pricing engines
- `status/`: status mapping and transition rules
- `validation/`: blocking issues, warnings, and workflow validators
- `permissions/`: role-aware access helpers
- `automation/`: reminders, queues, and scheduled workflows
- `ai/`: prompt templates and structured AI adapters
- `constants/`: shared stable constants
- `config/`: runtime config helpers
- `logging/`: event and debug logging helpers
- `integrations/`: external product/service adapters
- `types/`: shared type contracts
- `utils/`: generic utilities
- `repositories/`: persistence boundaries

## Refactor Status

Completed high-value extractions already in repo:
- Cold lead repository helpers moved into `src/core/repositories/`
- Lead business rules moved into `src/core/businessRules/`
- Validation engine moved into `src/core/validation/`
- Residential lead toolbar and lead edit helpers extracted into `src/features/leads/`
- Commercial leads fully decomposed into feature-level components plus helper actions

## Working Rules

- Prefer extracting one cohesive behavior slice at a time.
- Validate after each slice with a focused executable check.
- Preserve payload shape when moving DB or quote logic.
- Keep view components mostly declarative; move calculations and side effects outward.
- Avoid adding new domain logic to `src/App.jsx` if a `src/core/` or `src/features/` home already exists.

## Common Commands

Build:

```sh
npm run build
```

Focused tests used during refactors:

```sh
node --test tests/validateLead.test.mjs tests/validationEngine.test.mjs
```

## Near-Term Next Steps

- Move remaining pricing-specific orchestration from app-level usage into `src/core/pricing/`
- Continue reducing `src/App.jsx` responsibility to shell/router concerns
- Add status transition guards under `src/core/status/`
- Add role/capability helpers under `src/core/permissions/`
