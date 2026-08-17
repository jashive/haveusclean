export function resolveDefinition(kpiDefinitions, kpiCode, { asOf = Date.now() } = {}) {
  if (!Array.isArray(kpiDefinitions) || !kpiCode) {
    return { definition: null, error: "missing definition inputs" };
  }
  const applicable = kpiDefinitions.filter((definition) => {
    if (!definition || definition.code !== kpiCode || definition.active === false) return false;
    const effectiveFrom = definition.effective_from ? Date.parse(definition.effective_from) : null;
    const effectiveTo = definition.effective_to ? Date.parse(definition.effective_to) : null;
    if (effectiveFrom !== null && Number.isFinite(effectiveFrom) && effectiveFrom > asOf) return false;
    if (effectiveTo !== null && Number.isFinite(effectiveTo) && effectiveTo <= asOf) return false;
    return true;
  });
  const orgScoped = applicable.filter((definition) => definition.organization_id);
  const globalScoped = applicable.filter((definition) => !definition.organization_id);
  const preferredPool = orgScoped.length > 0 ? orgScoped : globalScoped;
  if (preferredPool.length === 0) {
    return { definition: null, error: `no active applicable definition for ${kpiCode}` };
  }
  if (preferredPool.length > 1) {
    return {
      definition: null,
      error: `ambiguous active definition for ${kpiCode}: ${preferredPool
        .map((definition) => definition.definition_version ?? "1")
        .join(", ")}`,
    };
  }
  return { definition: preferredPool[0], error: null };
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
