import { authenticatedRestFetch } from "./serviceosAuthClient.js";

export const GOVERNED_RESIDENTIAL_CONFIG_TYPE = "residential_pricing";
export const GOVERNED_RESIDENTIAL_REQUIRED_VERSION = "ON-2026-08-v1.0";
export const GOVERNED_RESIDENTIAL_REQUIRED_STATUS = "published";

function encode(value) {
  return encodeURIComponent(String(value ?? ""));
}

function assertRowMatches(row, { organizationId, businessUnitId, jurisdictionId, requiredVersion }) {
  if (!row || typeof row !== "object") {
    throw new Error("Governed residential config lookup failed: invalid row");
  }
  if (row.status !== GOVERNED_RESIDENTIAL_REQUIRED_STATUS) {
    throw new Error(`Governed residential config lookup failed: status must be ${GOVERNED_RESIDENTIAL_REQUIRED_STATUS}`);
  }
  if (row.version !== requiredVersion) {
    throw new Error(`Governed residential config lookup failed: version must be ${requiredVersion}`);
  }
  if (row.configuration_type !== GOVERNED_RESIDENTIAL_CONFIG_TYPE) {
    throw new Error(`Governed residential config lookup failed: configuration_type must be ${GOVERNED_RESIDENTIAL_CONFIG_TYPE}`);
  }
  if (row.organization_id !== organizationId) {
    throw new Error("Governed residential config lookup failed: organization mismatch");
  }
  if (row.business_unit_id !== businessUnitId) {
    throw new Error("Governed residential config lookup failed: business unit mismatch");
  }
  if (row.jurisdiction_id !== jurisdictionId) {
    throw new Error("Governed residential config lookup failed: jurisdiction mismatch");
  }
  if (!row.configuration || typeof row.configuration !== "object" || Array.isArray(row.configuration)) {
    throw new Error("Governed residential config lookup failed: configuration JSON missing");
  }
}

export async function fetchPublishedGovernedResidentialConfig({
  accessToken,
  organizationId,
  businessUnitId,
  jurisdictionId,
  requiredVersion = GOVERNED_RESIDENTIAL_REQUIRED_VERSION,
  fetcher = authenticatedRestFetch,
}) {
  if (!accessToken) throw new Error("Governed residential config lookup failed: accessToken required");
  if (!organizationId) throw new Error("Governed residential config lookup failed: organizationId required");
  if (!businessUnitId) throw new Error("Governed residential config lookup failed: businessUnitId required");
  if (!jurisdictionId) throw new Error("Governed residential config lookup failed: jurisdictionId required");

  const select = [
    "id",
    "organization_id",
    "business_unit_id",
    "jurisdiction_id",
    "configuration_type",
    "version",
    "status",
    "effective_from",
    "effective_to",
    "configuration",
  ].join(",");

  const path =
    `configuration_version?select=${select}` +
    `&organization_id=eq.${encode(organizationId)}` +
    `&business_unit_id=eq.${encode(businessUnitId)}` +
    `&jurisdiction_id=eq.${encode(jurisdictionId)}` +
    `&configuration_type=eq.${encode(GOVERNED_RESIDENTIAL_CONFIG_TYPE)}` +
    `&status=eq.${encode(GOVERNED_RESIDENTIAL_REQUIRED_STATUS)}` +
    `&version=eq.${encode(requiredVersion)}` +
    "&limit=2";

  const res = await fetcher(path, accessToken);
  if (!res || !res.ok) {
    const text = await res?.text?.().catch(() => "");
    throw new Error(`Governed residential config lookup failed: ${res?.status ?? "network error"} ${text}`);
  }
  const rows = await res.json();
  if (!Array.isArray(rows)) {
    throw new Error("Governed residential config lookup failed: invalid response");
  }
  if (rows.length === 0) {
    throw new Error("Governed residential config lookup failed: expected exactly one row, found 0");
  }
  if (rows.length > 1) {
    throw new Error(`Governed residential config lookup failed: expected exactly one row, found ${rows.length}`);
  }
  const row = rows[0];
  assertRowMatches(row, { organizationId, businessUnitId, jurisdictionId, requiredVersion });
  return row;
}
