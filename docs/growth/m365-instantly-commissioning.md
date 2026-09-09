# Microsoft 365 / Instantly commissioning contract

This is staging configuration only. It does not authorize sending and does not
change any Growth feature gate.

## Mail identity

- Mailbox provider: Microsoft 365 / Exchange Online.
- Pilot domain: `outreach.haveusclean.com`.
- Pilot mailbox: one licensed mailbox, proposed as
  `jason@outreach.haveusclean.com`.
- Campaign Reply-To: `info@haveusclean.ca`.
- Pilot market: `HUC-ON` only. Arizona remains staged.

## DNS staging packet

| Type | Host | Value | Priority |
| --- | --- | --- | --- |
| TXT | `outreach.haveusclean.com` | `v=spf1 include:spf.protection.outlook.com -all` | — |
| MX | `outreach.haveusclean.com` | Microsoft 365 domain-specific value shown in Admin Center | `10` |
| CNAME | `selector1._domainkey.outreach.haveusclean.com` | Microsoft 365 tenant-generated selector 1 target | — |
| CNAME | `selector2._domainkey.outreach.haveusclean.com` | Microsoft 365 tenant-generated selector 2 target | — |
| TXT | `_dmarc.outreach.haveusclean.com` | `v=DMARC1; p=none; pct=100; rua=mailto:dmarc@haveusclean.com; adkim=s; aspf=s` | — |

The MX and DKIM targets are not derivable from the public domain name. Copy
them exactly from Microsoft 365 Admin Center after adding
`outreach.haveusclean.com`; never substitute an invented tenant slug.

## Server-only environment

- `GROWTH_ENVIRONMENT=acceptance`
- `GROWTH_WEBHOOK_SECRET`: cryptographically random value of at least 32 bytes
- `INSTANTLY_API_KEY`: scoped Instantly API v2 key
- `SUPABASE_URL`: Growth Acceptance project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Growth Acceptance server secret

Neither secret may use a `VITE_` prefix, enter a client bundle, be logged, or
be persisted in Growth tables.

## Ingestion boundary

`POST /api/growth/instantly-webhook` rewrites to the existing Acceptance-only
`api/wave4-rls-acceptance-harness.js` function, preserving the 12-function cap.
The handler:

1. rejects Production and unknown environments;
2. requires `X-Growth-Webhook-Secret` and uses `crypto.timingSafeEqual`;
3. rejects secrets shorter than 32 bytes and payloads over 256 KiB;
4. requires the immutable Growth scope carried in `growth_context`;
5. maps documented Instantly delivery events to the governed event vocabulary;
6. calls `growth_g2_ingest_delivery_event`, whose transaction and unique
   `(provider, provider_event_id)` index provide atomic replay protection.

All execution gates remain OFF during commissioning.
