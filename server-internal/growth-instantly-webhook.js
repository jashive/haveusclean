import { createHash, timingSafeEqual } from "node:crypto";

const EVENT_TYPES = Object.freeze({
  email_sent: "submitted",
  email_bounced: "bounce",
  account_error: "failed",
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function secretMatches(provided, expected) {
  if (Buffer.byteLength(expected, "utf8") < 32 || !provided) return false;
  return timingSafeEqual(digest(provided), digest(expected));
}

function environment() {
  return text(process.env.GROWTH_ENVIRONMENT || process.env.SERVICEOS_ENVIRONMENT).toLowerCase();
}

function eventContract(body) {
  const context = body?.growth_context || body?.metadata?.growth_context || {};
  return {
    eventType: EVENT_TYPES[text(body?.event_type)],
    providerEventId: text(body?.event_id || body?.id),
    providerMessageId: text(body?.email_id || body?.message_id),
    occurredAt: text(body?.timestamp || body?.timestamp_created),
    organizationId: text(context.organization_id),
    businessUnitId: text(context.business_unit_id),
    jurisdictionId: text(context.jurisdiction_id),
    outreachAttemptId: text(context.outreach_attempt_id),
  };
}

function missingFields(event) {
  return ["eventType", "providerEventId", "providerMessageId", "occurredAt", "organizationId",
    "businessUnitId", "jurisdictionId", "outreachAttemptId"].filter((key) => !event[key]);
}

export default async function handleGrowthInstantlyWebhook(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!new Set(["acceptance", "preview", "test"]).has(environment())) {
    return res.status(403).json({ error: "Growth webhook is restricted to Acceptance" });
  }

  const expected = text(process.env.GROWTH_WEBHOOK_SECRET);
  const provided = text(req.headers?.["x-growth-webhook-secret"]);
  if (!secretMatches(provided, expected)) return res.status(401).json({ error: "Unauthorized" });

  const contentLength = Number(req.headers?.["content-length"] || 0);
  if (contentLength > 262144) return res.status(413).json({ error: "Payload too large" });

  const event = eventContract(req.body);
  const missing = missingFields(event);
  if (missing.length) return res.status(422).json({ error: "Invalid webhook contract", missing });

  const supabaseUrl = text(process.env.SUPABASE_URL);
  const serviceKey = text(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
  if (!supabaseUrl || !serviceKey) return res.status(503).json({ error: "Acceptance persistence unavailable" });

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/growth_g2_ingest_delivery_event`, {
    method: "POST",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      p_organization_id: event.organizationId,
      p_business_unit_id: event.businessUnitId,
      p_jurisdiction_id: event.jurisdictionId,
      p_outreach_attempt_id: event.outreachAttemptId,
      p_provider: "instantly",
      p_provider_message_id: event.providerMessageId,
      p_provider_event_id: event.providerEventId,
      p_event_type: event.eventType,
      p_occurred_at: event.occurredAt,
      p_payload: req.body,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) return res.status(502).json({ error: "Governed event ingestion failed" });
  return res.status(200).json({ accepted: true, event_id: payload });
}
