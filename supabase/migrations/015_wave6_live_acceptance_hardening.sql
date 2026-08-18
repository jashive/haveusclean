-- =============================================================================
-- Migration 015 — Wave 6 Live Acceptance Hardening
-- =============================================================================
-- Purpose  : Additive corrective migration that brings the already-live Wave 6
--            schema to the same final contract as the corrected migration 014.
--
-- Blockers addressed:
--   L1 — release_gate trigger must fail CLOSED when predecessor row is absent
--   L2 — wave6_canonical_event must be SELECT-only for authenticated
--
-- Contract:
--   1. Fixes live release-gate fail-closed behavior (L1).
--   2. Revokes all privileges on wave6_canonical_event from authenticated,
--      then restores SELECT only (L2).
--   3. Idempotent / safe for the existing Wave 6 live schema.
--   4. Contains deterministic self-validation (SV blocks).
--   5. Fails closed if expected Wave 6 objects are absent.
--   6. Does NOT recreate or mutate Wave 6 business evidence / seeds.
--   7. Does NOT touch huc_* objects.
--   8. Does NOT alter Waves 1–5 business data.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PREFLIGHT: Wave 6 objects must exist before this migration is applied.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count integer;
BEGIN
  -- release_gate table must exist (L1 target).
  SELECT COUNT(*) INTO v_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'release_gate';
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'M015 PREFLIGHT FAIL: public.release_gate does not exist — '
      'apply migration 014 before 015';
  END IF;

  -- wave6_canonical_event view must exist (L2 target).
  SELECT COUNT(*) INTO v_count
  FROM information_schema.views
  WHERE table_schema = 'public' AND table_name = 'wave6_canonical_event';
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'M015 PREFLIGHT FAIL: public.wave6_canonical_event does not exist — '
      'apply migration 014 before 015';
  END IF;

  -- Trigger function must exist (we are replacing it).
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'trg_enforce_release_gate_sequence';
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'M015 PREFLIGHT FAIL: trigger function public.trg_enforce_release_gate_sequence '
      'does not exist — apply migration 014 before 015';
  END IF;

  -- Fail closed if duplicate sequence_order values already exist in release_gate.
  -- Duplicates would make predecessor resolution ambiguous; this migration must not
  -- proceed until the live data is clean.
  SELECT COUNT(*) INTO v_count
  FROM (
    SELECT sequence_order
    FROM public.release_gate
    GROUP BY sequence_order
    HAVING COUNT(*) > 1
  ) dups;
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'M015 PREFLIGHT FAIL: public.release_gate contains % duplicate sequence_order '
      'value(s) — resolve duplicates before applying this migration',
      v_count;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- L1 FIX: Replace the release_gate sequence enforcement trigger function.
--
-- Corrected behaviour:
--   • PILOT (sequence_order = 1) has no predecessor — it may pass freely.
--   • Any gate with sequence_order > 1 REQUIRES exactly one predecessor row
--     at sequence_order - 1 that is already 'passed'.
--   • Missing predecessor → REJECT (fail closed, not silently allowed).
--   • Predecessor not yet passed → REJECT.
--   • Passed gates are fully immutable: no column may be updated.
--
-- The previous implementation used "IF FOUND AND v_prev_status <> 'passed'"
-- which allowed a missing predecessor to silently succeed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_enforce_release_gate_sequence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_prev_status text;
BEGIN
  -- Terminal immutability: a passed gate row cannot be modified at all.
  IF OLD.gate_status = 'passed' THEN
    RAISE EXCEPTION
      'release_gate: gate % (id=%) is passed — terminal evidence is immutable',
      OLD.gate_code, OLD.id
      USING ERRCODE = 'P0001';
  END IF;

  -- When moving to passed, enforce the linear predecessor chain.
  -- PILOT (sequence 1) has no predecessor and may proceed freely.
  -- Any gate with sequence_order > 1 MUST have exactly one predecessor at
  -- sequence_order - 1 that is already 'passed'.  A missing predecessor is
  -- rejected (fail closed), not silently allowed.
  IF NEW.gate_status = 'passed' AND OLD.gate_status <> 'passed' THEN
    IF NEW.sequence_order > 1 THEN
      SELECT rg.gate_status INTO v_prev_status
      FROM public.release_gate rg
      WHERE rg.sequence_order = (NEW.sequence_order - 1)
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'release_gate: cannot pass gate % (sequence %) — predecessor at sequence % is absent',
          NEW.gate_code, NEW.sequence_order, (NEW.sequence_order - 1)
          USING ERRCODE = 'P0001';
      END IF;

      IF v_prev_status <> 'passed' THEN
        RAISE EXCEPTION
          'release_gate: cannot pass gate % (sequence %) before predecessor (sequence %) is passed',
          NEW.gate_code, NEW.sequence_order, (NEW.sequence_order - 1)
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_release_gate_sequence() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_enforce_release_gate_sequence() FROM anon;
REVOKE ALL ON FUNCTION public.trg_enforce_release_gate_sequence() FROM authenticated;

COMMENT ON FUNCTION public.trg_enforce_release_gate_sequence() IS
  'Wave 6 (015 hardening): DB-level release_gate sequence enforcement. '
  'Passed gates are immutable. A gate with sequence_order > 1 cannot pass if its '
  'predecessor is absent (fail closed) or not yet passed.';

-- ---------------------------------------------------------------------------
-- B1 FIX: Enforce uniqueness of sequence_order on release_gate.
--
-- Migration 014 defined only a plain index on sequence_order.  A UNIQUE
-- constraint is required so that predecessor resolution via
-- WHERE sequence_order = N is always unambiguous (exactly one row).
-- This block is idempotent: it adds the constraint only if absent.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = 'release_gate'
      AND c.contype = 'u'
      AND c.conname = 'uq_rg_sequence_order'
  ) THEN
    ALTER TABLE public.release_gate
      ADD CONSTRAINT uq_rg_sequence_order UNIQUE (sequence_order);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- L2 FIX: Restore wave6_canonical_event to SELECT-only for authenticated.
--
-- Migration 014 revoked PUBLIC and anon but did not REVOKE ALL from
-- authenticated before granting SELECT.  Inherited/default privileges left
-- DELETE, INSERT, UPDATE, REFERENCES, TRIGGER, and TRUNCATE exposed.
-- This block reasserts the complete final view privilege contract:
--   PUBLIC        = none
--   anon          = none
--   authenticated = SELECT only
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.wave6_canonical_event FROM PUBLIC;
REVOKE ALL ON public.wave6_canonical_event FROM anon;
REVOKE ALL ON public.wave6_canonical_event FROM authenticated;
GRANT SELECT ON public.wave6_canonical_event TO authenticated;

-- ---------------------------------------------------------------------------
-- SELF-VALIDATION (deterministic — blocks COMMIT on any failure)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_count        integer;
  v_has_priv     boolean;
  v_prev_status  text;
BEGIN

  -- [SV-015-1] Trigger function exists and is security definer.
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'trg_enforce_release_gate_sequence'
    AND p.prosecdef = true;
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'M015 SV-1 FAIL: trg_enforce_release_gate_sequence is missing or not SECURITY DEFINER';
  END IF;

  -- [SV-015-2] Trigger function is not directly executable by authenticated.
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL unnest(COALESCE(p.proacl, ARRAY[]::aclitem[])) AS acl(entry)
    WHERE n.nspname = 'public'
      AND p.proname = 'trg_enforce_release_gate_sequence'
      AND (
        acl.entry::text LIKE '%authenticated%=%X%'
        OR acl.entry::text LIKE '=%X%'
        OR acl.entry::text LIKE '%anon%=%X%'
      )
  ) INTO v_has_priv;
  IF v_has_priv THEN
    RAISE EXCEPTION
      'M015 SV-2 FAIL: trg_enforce_release_gate_sequence is executable by PUBLIC/anon/authenticated';
  END IF;

  -- [SV-015-3] wave6_canonical_event view still exists.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.views
  WHERE table_schema = 'public' AND table_name = 'wave6_canonical_event';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'M015 SV-3 FAIL: view public.wave6_canonical_event not found';
  END IF;

  -- [SV-015-4] authenticated has SELECT on wave6_canonical_event.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema  = 'public'
    AND table_name    = 'wave6_canonical_event'
    AND grantee       = 'authenticated'
    AND privilege_type = 'SELECT';
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'M015 SV-4 FAIL: authenticated does not have SELECT on public.wave6_canonical_event';
  END IF;

  -- [SV-015-5] authenticated must NOT have any non-SELECT privilege on wave6_canonical_event,
  -- including REFERENCES (which information_schema does expose for named roles).
  SELECT COUNT(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema  = 'public'
    AND table_name    = 'wave6_canonical_event'
    AND grantee       = 'authenticated'
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES');
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'M015 SV-5 FAIL: authenticated has write/mutating privilege(s) on '
      'public.wave6_canonical_event — expected SELECT only';
  END IF;

  -- [SV-015-6] anon must have no privilege on wave6_canonical_event.
  SELECT COUNT(*) INTO v_count
  FROM information_schema.role_table_grants
  WHERE table_schema  = 'public'
    AND table_name    = 'wave6_canonical_event'
    AND grantee       = 'anon';
  IF v_count > 0 THEN
    RAISE EXCEPTION
      'M015 SV-6 FAIL: anon holds privilege(s) on public.wave6_canonical_event — expected none';
  END IF;

  -- [SV-015-7] Removed intentionally:
  -- existence of retained legacy huc_* tables is valid and must not block M015.

  -- [SV-015-8] PUBLIC must have no privilege on wave6_canonical_event.
  -- information_schema does not reliably expose PUBLIC entries; use pg_catalog ACL.
  -- ACL entries for PUBLIC have no role name before the '=', e.g. '=r/grantor'.
  SELECT COALESCE(
    (SELECT bool_or(a.acl::text ~ '^=')
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     CROSS JOIN LATERAL unnest(COALESCE(c.relacl, ARRAY[]::aclitem[])) AS a(acl)
     WHERE n.nspname = 'public' AND c.relname = 'wave6_canonical_event'),
    false
  ) INTO v_has_priv;
  IF v_has_priv THEN
    RAISE EXCEPTION
      'M015 SV-8 FAIL: PUBLIC holds privilege(s) on public.wave6_canonical_event — expected none';
  END IF;

  -- [SV-015-9] release_gate.sequence_order uniqueness constraint must exist.
  SELECT COUNT(*) INTO v_count
  FROM pg_constraint c
  JOIN pg_class r ON r.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname = 'public'
    AND r.relname = 'release_gate'
    AND c.contype = 'u'
    AND c.conname = 'uq_rg_sequence_order';
  IF v_count = 0 THEN
    RAISE EXCEPTION
      'M015 SV-9 FAIL: uq_rg_sequence_order unique constraint not found on '
      'public.release_gate — predecessor resolution would be ambiguous';
  END IF;

  RAISE NOTICE 'M015_WAVE6_HARDENING_PASS';
END;
$$;

-- Final deterministic result
SELECT 'M015_WAVE6_HARDENING_PASS'::text AS result;

COMMIT;
