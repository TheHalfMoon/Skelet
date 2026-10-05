# Skelet Data Provenance Policy

Status: canonical data, asset, and derived-metadata provenance policy

## Purpose

Skelet's product value depends on design evidence: screenshots, flows, logos, icons, fonts, components, extracted tokens, OCR text, metadata, and derived relationships. Those materials do not all share the same rights or serving policy.

Data provenance is governed separately from code provenance.

A source-code permission or open-source license does not automatically grant rights to screenshots, user content, datasets, hosted assets, model weights, trademarks, or third-party media referenced by the code.

## Canonical Data Lineage

Every imported or captured canonical object must be traceable to a Source and, where applicable, an import batch, CaptureRun, AnalysisRun, or ProductVersion.

Minimum lineage fields include:

- source identity;
- external/source record ID when available;
- source URL when appropriate;
- capture/import timestamp;
- immutable source or batch identity;
- content hash for retained bytes;
- rights classification;
- serving policy;
- derivation relationship for transformed or inferred records.

## Rights Scope

`UPSTREAMS.lock.yml` separates the following rights dimensions:

- `code`;
- `data`;
- `assets`;
- `models`;
- `services`;
- `trademarks`.

Allowed classifications are:

- `authorized`: an explicit authorization covers the stated dimension;
- `license-governed`: use is governed by a verified license;
- `verify-at-import`: rights have not yet been resolved for activation;
- `not-applicable`: the source does not provide that material for the planned capability;
- `restricted`: Skelet must not assume redistribution/use beyond the documented restricted purpose.

A source may not become an active data importer while a required dimension remains `verify-at-import`.

## Asset Serving Policy

Rights to index metadata and rights to redistribute bytes are separate.

Every downloadable or remotely served Asset must have an explicit serving policy such as:

- `serve`: Skelet may deliver the retained bytes;
- `metadata-only`: Skelet may index descriptive metadata but not redistribute bytes;
- `link-only`: Skelet exposes the authoritative external source URL only;
- `private-workspace-only`: retained bytes may be used only inside the authorized workspace;
- `restricted`: no public delivery until rights are resolved.

The implementation may refine these values, but it must preserve the distinction between metadata indexing and byte redistribution.

## Screenshots and Product Captures

A screenshot is evidence of a product state, not automatically a freely redistributable asset.

For each corpus or capture source, classify:

- permission to capture;
- permission to retain;
- permission to display publicly;
- permission to redistribute/download;
- permitted derivative analysis such as OCR, embeddings, token extraction, and pattern classification;
- retention and takedown requirements.

Do not infer screenshot rights from the license of a crawler or capture tool.

## Logos, Brands, and Trademarks

A logo file license does not eliminate trademark obligations.

Brand assets should retain:

- authoritative source when known;
- brand/trademark owner;
- light/dark/monochrome/wordmark/mark variant information;
- license or source terms;
- trademark/brand-guideline URL when available;
- serving policy.

Skelet must not represent a brand as endorsing Skelet merely because the logo can be indexed or displayed as design evidence.

## Fonts

Font metadata may be indexable when the font bytes themselves are not redistributable.

Before serving font files, verify the governing font license and redistribution rights for the exact files/version being retained.

Restricted fonts may remain metadata-only or link-only.

## Components and Code-Like Assets

A component can contain both code and design assets.

Its provenance must preserve:

- source code license/permission;
- third-party package dependencies;
- bundled icons/images/fonts and their separate rights;
- external service requirements;
- original source URL and immutable pin.

A component may not be published through the Skelet registry merely because its source file can be copied if its bundled assets or dependencies are not redistributable.

## Model Weights and Training Data

Model code, model weights, tokenizer/config files, and training/evaluation datasets are distinct provenance classes.

Do not treat a repository license as permission to redistribute model weights or datasets unless the governing terms explicitly cover them.

Any local model used for OCR, embeddings, GUI parsing, ranking, or generation must record:

- model identity/version;
- weights source;
- weights license;
- required notices;
- permitted use/redistribution scope;
- input/output data retention behavior.

## Derived Metadata

Derived records include OCR text, embeddings, design tokens, extracted color palettes, UI-element detections, technology clues, pattern labels, and similarity relations.

Each derived record must distinguish its evidence class:

- observed;
- deterministic transformation;
- heuristic inference;
- model-generated inference.

Derived metadata must preserve a relation to the evidence used to create it. Model-generated output must not overwrite observed source facts.

## Private Workspace Data

Private workspace content must remain workspace-scoped.

It must not enter:

- the public Skelet corpus;
- global similarity/ranking training sets;
- cross-customer analytics containing recoverable content;
- an external AI provider request;

without explicit user/workspace authorization consistent with the configured privacy policy.

## Import Batch Requirements

Every material dataset import must record:

- source ID;
- immutable batch/source identity;
- import timestamp;
- records attempted, accepted, rejected, and deduplicated;
- importer version/HEAD;
- rights/serving policy used for the batch;
- transformation/enrichment steps;
- validation failures;
- canonical Skelet IDs created or updated.

Imports must be idempotent and replayable where the governing source permits replay.

## Retention, Deletion, and Takedown

If a source requires deletion, expiry, takedown, or restricted retention, those obligations must be represented operationally rather than only documented in prose.

Deleting or restricting original evidence must also address public derivatives that would reveal the restricted content, while preserving non-sensitive audit evidence needed to explain the action.

## No Rights Guessing

When material rights are ambiguous, the safe state is `verify-at-import` or `restricted`, not public serving.

Product urgency, visual usefulness, or technical accessibility is not evidence of permission to redistribute data or assets.
