# Security Policy

## Reporting a vulnerability

Please report security issues privately to **security@vinkius.com**. Do not open
public issues for vulnerabilities. We aim to acknowledge reports within 3
business days and to provide a remediation timeline after triage.

## Security model

`@vinkius/connect` is designed to minimize the secret surface an integrator has
to manage.

- **One secret only.** The SDK is initialized with a public application id
  (`vk_app_*`) and a single secret application key (`vk_app_sk_*`). The secret
  is sent only as an `Authorization: Bearer` header over HTTPS.
- **The runtime token never reaches the SDK.** Tool execution is proxied by the
  Vinkius API; the internal data-plane token (`vk_live_*`) is created, rotated,
  and used entirely server-side. There is no runtime secret for your application
  to store or leak.
- **Credentials are write-only.** End-user credentials are stored through the
  API and never returned; the SDK can only report which keys are configured.
- **Zero runtime dependencies.** The core ships with no third-party runtime
  dependencies, keeping the supply-chain surface minimal.
- **Redaction by default.** Observability hooks receive redacted headers and
  bodies — `Authorization`, tokens, and credential-like fields never reach a
  logger through the SDK.
- **Transport safety.** Non-`localhost` `http://` base URLs emit a warning;
  always use `https://` in production.
- **Blast radius.** A leaked `vk_app_sk_*` is scoped to a single application; the
  API rejects cross-tenant access with a 404.

## Supported versions

Pre-1.0 releases receive security fixes on the latest minor version.
