# Security verification matrix — October 2026

This checklist reports observed code controls, NOT a penetration-test certificate.

| Area | Existing protection / observation | Remaining requirement |
| --- | --- | --- |
| Request rate limiting | Per-socket-IP API window: 240 requests per 60 seconds in one process, plus existing login failure throttling | Validate burst handling in deployment; proxy/edge rate limiting and multi-instance shared counters; exempt or separately budget long uploads and health checks |
| Login throttle | Existing five failed-login threshold. Keys use actual remote socket IP, not spoofable X-Forwarded-For | Use trusted proxy allowlist before reading forwarded client IP; add account-only dimension, bounded failed-login map and distributed store |
| OAuth 2.0 / OIDC | No verified OIDC authorization-code/PKCE login integration found during this review | Implement issuer/JWKS verification, audience, state, nonce, PKCE, refresh/token revocation and redirect allowlists before claiming OAuth support |
| RBAC | Effective permission sets, requirePermission and API-token scopes exist | Route-by-route deny-by-default automated authorization matrix; test all admin, storage, network, VM and container mutations against least-privileged users |
| Validation | JSON body bounded to 128 KiB, URL/path handling and narrow scoped data checks exist | Per-endpoint schema validation, file content validation, SSRF defenses, storage/command arg checks and malformed-body tests |
| HTTPS | Node supports TLS options; Caddy TLS template; SameSite=Strict cookies and secure-cookie flag on requests regarded as HTTPS | Require authenticated TLS on exposed management endpoints; restrict/verify trusted proxy identity before X-Forwarded-Proto; certificate issuance/renewal, HSTS on HTTPS, HTTP redirect and TLS scanner tests |
| CSRF / origin | Same-origin / fetch-metadata checks and custom request header on state-changing cookie-auth APIs | Validate origin behavior across proxies and legacy clients; test websocket upgrade auth and origin |

Do not interpret this document or a successful source test as confirmation that a deployed LightNAS instance is secure. Avoid using an untrusted forwarded header to determine transport/client identity.
