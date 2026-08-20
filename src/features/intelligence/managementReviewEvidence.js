import { resolveGovernedKpiDefinition } from "../../lib/wave6DefinitionResolver.js";

export function resolveDefinition(kpiDefinitions, kpiCode, scope) {
  return resolveGovernedKpiDefinition(kpiDefinitions, {
    organizationId: scope?.organizationId,
    kpiCode,
    periodType: scope?.periodType,
    periodStart: scope?.periodStart,
    periodEnd: scope?.periodEnd,
  });
}

function isPopulatedObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

export function buildSnapshotSourceLineage(definition, kpi) {
  const runtime = kpi?.sourceLineage?.runtime;
  if (!isPopulatedObject(runtime)) return null;
  return {
    definition_ref: {
      kpi_code: definition.code,
      definition_version: definition.definition_version ?? "1",
    },
    definition: definition.source_lineage ?? {},
    runtime,
  };
}

export function normalizeManifestEntry(entry) {
  if (!entry?.kpi_snapshot_id || !entry?.kpi_code || !entry?.definition_version || !entry?.captured_at) {
    return null;
  }
  return {
    kpi_snapshot_id: entry.kpi_snapshot_id,
    kpi_code: entry.kpi_code,
    definition_version: entry.definition_version,
    captured_at: entry.captured_at,
  };
}

export function mergeSnapshotManifest(currentManifest, additions) {
  const merged = new Map();
  for (const entry of [...(Array.isArray(currentManifest) ? currentManifest : []), ...additions]) {
    const normalized = normalizeManifestEntry(entry);
    if (!normalized) continue;
    merged.set(normalized.kpi_snapshot_id, normalized);
  }
  return [...merged.values()];
}
