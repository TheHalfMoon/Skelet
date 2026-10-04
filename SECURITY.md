# Skelet Security Charter

Status: canonical security and privacy constraints for implementation

## Security Objective

Skelet ingests untrusted URLs, HTML, SVG, images, files, donor data, and agent requests. The default posture is fail-closed isolation, explicit authority, minimal egress, and recoverable evidence.

No product feature may bypass these boundaries for convenience.

## Trust Boundaries

Treat the following as untrusted until validated:

- user-supplied URLs and redirects;
- remote DNS responses;
- downloaded HTML, JavaScript, CSS, SVG, fonts, images, archives, and documents;
- uploaded screenshots and files;
- donor datasets and metadata;
- provider outputs;
- MCP/API arguments;
- workspace IDs, object IDs, and resource URIs supplied by clients.

## URL and Lens Capture

Only `http` and `https` are accepted for network capture.

Before navigation and after every redirect or relevant DNS resolution, reject:

- loopback ranges;
- RFC1918/private ranges;
- IPv6 loopback, private, and link-local addresses;
- carrier-grade NAT ranges;
- reserved/documentation/special-use ranges where access is not explicitly required;
- cloud metadata endpoints;
- public DNS names that resolve to blocked addresses.

DNS rebinding defenses must revalidate targets during the navigation lifecycle.

Capture workers must have:

- no production session cookies;
- no cloud credentials;
- no SSH keys;
- no developer home-directory secrets;
- bounded CPU, memory, navigation count, response bytes, and wall-clock time;
- deterministic cleanup after timeout or browser failure.

## Untrusted Preview Isolation

Never render captured HTML or SVG in a privileged same-origin application context.

Captured active content must be sanitized, converted to inert output, or rendered inside a sandbox with no ambient filesystem, process, secret, network, MCP, or application-session authority.

## Authentication and Workspace Authorization

Remote MCP and write-capable REST operations require authenticated authority.

Every workspace-scoped read or write must verify membership and role server-side. Client-supplied workspace IDs, collection IDs, asset IDs, and Skelet URIs are never trusted as authorization evidence.

The test matrix must prove:

- user A cannot read workspace B;
- user A cannot write workspace B;
- forged object IDs do not bypass scope checks;
- expired or revoked sessions fail closed;
- write tools reject unauthenticated requests;
- plan quotas and rate limits cannot be bypassed through alternate public interfaces.

## Secrets

Secrets must never be committed to Git, returned through API/MCP result payloads, or emitted in normal logs.

Logs and traces must redact:

- API keys;
- session tokens;
- cookies;
- authorization headers;
- provider credentials;
- BYOK values;
- signed webhook secrets.

Provider credentials are passed only to the provider process that requires them.

## External AI and Data Egress

The qualified Skelet path must work with external LLM providers disabled.

Any external model call requires:

- explicit provider configuration;
- an egress classification;
- defined input data classes;
- a retention policy when the provider exposes one;
- AnalysisRun lineage identifying provider and model;
- cost attribution when available.

Private workspace content must never enter a global training corpus, ranking corpus, or external model request without explicit authorization.

## Import and Supply-Chain Security

Every donor import binds to an immutable commit, release, or content hash verified at execution time.

Before imported code becomes canonical:

- provenance must be recorded;
- license/permission scope must be recorded;
- selected paths must be declared before copying;
- unexpected binaries, generated corpora, credentials, and deployment assumptions must be excluded;
- dependency changes must be reviewed independently from source-copy permission.

Source-code permission does not imply rights to model weights, datasets, screenshots, hosted services, trademarks, or separately licensed assets.

## Billing and Webhooks

Webhook signatures must be verified before any state transition.

Handlers must be replay-safe and idempotent. Billing state must never grant authority based solely on client-provided plan fields.

## Evidence and Observability

Security-relevant actions must be attributable to an authenticated identity, workspace, CaptureRun, AnalysisRun, import batch, or provider execution as applicable.

Observability must expose enough context for incident reconstruction without retaining secrets or unnecessary private payloads.

## Mandatory Regression Matrix

At minimum, URL/Lens qualification must cover:

- localhost and `127.0.0.0/8`;
- RFC1918 ranges;
- IPv6 private/link-local/loopback ranges;
- cloud metadata endpoints;
- public DNS resolving to private IP;
- public redirect to a blocked target;
- DNS rebinding simulation;
- unsupported schemes including `file:`, `data:`, `javascript:`, and `ftp:`;
- oversized downloads;
- redirect loops;
- page timeout and browser cleanup;
- hostile SVG/HTML preview isolation;
- capture-worker secret isolation.

MCP/API qualification must cover cross-workspace isolation, forged identifiers, anonymous write denial, revoked sessions, rate limits, secret redaction, and safe error responses.

## Merge Rule

A known security boundary violation is blocking. It cannot be waived by product urgency, donor provenance, passing UI tests, or model-generated review confidence.
