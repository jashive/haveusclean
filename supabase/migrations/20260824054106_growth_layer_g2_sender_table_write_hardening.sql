revoke all on growth.sender_identity from service_role;
revoke all on growth.sender_auth_evidence from service_role;
revoke all on growth.sender_health_snapshot from service_role;
grant select on growth.sender_identity to service_role;
grant select on growth.sender_auth_evidence to service_role;
grant select on growth.sender_health_snapshot to service_role;
