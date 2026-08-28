-- G6 migration-history reconciliation.
-- Acceptance verified the actual G2 provider schema: provider_runtime_binding does not carry
-- adapter_version; provider_adapter_allowlist and provider_activation_approval do, and the
-- activation state column is approval_status. The clean-source 20260828174019 migration already
-- contains the aligned readiness evaluator. This no-op preserves the exact Acceptance ledger.
select 1;
