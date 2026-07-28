# Core Architecture

This directory is the long-term home for application logic that should not live in feature UI files or in the app shell.

Current live areas:
- `businessRules/`: cross-feature domain normalization and merge rules
- `repositories/`: Supabase REST access helpers and persistence boundaries
- `validation/`: shared validation engine and workflow-safe validation helpers

Scaffolded areas for the next refactor phases:
- `pricing/`: pricing engines, quote adapters, package/floor rules
- `status/`: status transition policies and domain-specific transition guards
- `permissions/`: role checks, allowlists, capability helpers
- `automation/`: workflow automation orchestration and scheduling helpers
- `ai/`: prompt builders, response parsers, AI workflow helpers
- `constants/`: durable shared constants that should not remain in feature files
- `config/`: runtime config composition beyond environment access
- `logging/`: structured logging and audit/event helpers
- `integrations/`: external system adapters beyond raw repositories
- `types/`: shared schema/type declarations when the repo introduces them
- `utils/`: generic non-domain helpers that do not belong to a feature

Guidelines:
- Put domain logic here before adding more logic to `src/App.jsx`.
- Keep feature UI components in `src/features/` and pass them only what they need.
- Prefer additive extractions that preserve behavior and payload shape.
