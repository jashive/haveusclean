function toMillis(value) {
  if (!value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function parsePeriodSupport(definition) {
  const support = definition?.period_support;
  if (Array.isArray(support)) return support;
  if (typeof support === "string" && support.trim() !== "") {
    return support
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function coversMeasurementWindow(definition, periodStartMillis, periodEndMillis) {
  const effectiveFrom = toMillis(definition?.effective_from);
  const effectiveTo = toMillis(definition?.effective_to);
  if (effectiveFrom !== null && effectiveFrom > periodStartMillis) return false;
  if (effectiveTo !== null && effectiveTo < periodEndMillis) return false;
  return true;
}

export function resolveGovernedKpiDefinition(
  definitions,
  { organizationId, kpiCode, periodType, periodStart, periodEnd }
) {
  if (!Array.isArray(definitions) || !kpiCode || !periodType || !periodStart || !periodEnd) {
    return { definition: null, error: "missing definition-resolution inputs" };
  }

  const periodStartMillis = toMillis(periodStart);
  const periodEndMillis = toMillis(periodEnd);
  if (!Number.isFinite(periodStartMillis) || !Number.isFinite(periodEndMillis)) {
    return { definition: null, error: "invalid governed period" };
  }
  if (periodEndMillis <= periodStartMillis) {
    return { definition: null, error: "governed period must be ordered" };
  }

  const applicable = definitions.filter((definition) => {
    if (!definition || definition.code !== kpiCode || definition.active === false) return false;
    const support = parsePeriodSupport(definition);
    if (!support.includes(periodType)) return false;
    const scopedOrgId = definition.organization_id ?? null;
    if (scopedOrgId !== null && scopedOrgId !== organizationId) return false;
    return coversMeasurementWindow(definition, periodStartMillis, periodEndMillis);
  });

  if (applicable.length === 0) {
    return {
      definition: null,
      error: `no active applicable definition covering governed period for ${kpiCode}`,
    };
  }

  const orgScoped = applicable.filter((definition) => definition.organization_id === organizationId);
  const globalScoped = applicable.filter((definition) => definition.organization_id == null);
  const pool = orgScoped.length > 0 ? orgScoped : globalScoped;

  if (pool.length !== 1) {
    return {
      definition: null,
      error: `ambiguous governed definition for ${kpiCode} (${pool
        .map((definition) => definition.definition_version ?? "1")
        .join(", ")})`,
    };
  }

  return { definition: pool[0], error: null };
}
