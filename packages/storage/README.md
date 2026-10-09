# Skelet Local Object Storage (G03-04)

This package contains a byte-level **internal storage provider**, not a public asset server.

- Uploads are incremental and bounded by a configured maximum byte and time budget.
- Bytes are streamed into randomly named owner-private temporary files, hashed with SHA-256, fsynced, then independently re-hashed from disk before atomic linking into `sha256/xx/<digest>` with no-clobber semantics.
- Competing uploads with identical bytes converge to one object; an existing object must pass full hash verification before reuse. The implementation **requires filesystem hardlink support** and fails closed when unavailable.
- Reads fully hash-verify the existing object before yielding bytes from the same open file handle. This protects against path swaps; it does not defend against a separately privileged process rewriting an already-open inode in place.
- Only SHA-256 derived internal keys are accepted, not caller-provided paths or arbitrary download URLs.
- Root and managed directories must be private to the trusted Skelet service account; direct writes by untrusted local users or deployment of the directory as a public webroot are forbidden. POSIX directory modes are enforced; Windows ACL ownership and isolation must be configured by the operator.
- Aborted writes remove their own temporary file. `pruneTemporary` only removes old, UUID-named temporary files; it never deletes published objects.
- An object key does **not** confer redistribution rights, tenant authorization, or publication permission. The G03-02 Asset repository must separately qualify rights/source provenance and only then publish canonical metadata. No public reading route, S3 adapter, arbitrary deletion, or asset takedown service is introduced in this grain.
- Refcount-aware object deletion, derivative and cache purge, and durable store+DB transactional publication belong to later governed ingestion and retention grains. A crash between byte promotion and metadata publication can leave an unreferenced object; this is not described as a published Asset.
- No paid infrastructure, GPU, or external model is required.

Run `pnpm --filter skelet-storage typecheck`, `pnpm --filter skelet-storage lint`, and `node --experimental-strip-types --test packages/storage/tests/storage.test.mjs`.
