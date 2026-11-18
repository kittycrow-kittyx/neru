# Wire and inode contracts

- `SHARED_FS_SCHEMA` identifies the protocol version.
- `PERSISTENT_ROOTS` and `KERNEL_LOCAL_ROOTS` name the root groups.
- `SharedKind` distinguishes files, directories and symbolic links.
- `InodeMetadata` contains their common attributes.
- `SharedEntry` represents a path in a snapshot; `StoredInode` carries raw bytes; `ManifestInode` refers to content hashes.
- `SharedSnapshot` identifies one complete generation.
- `SharedOperation`, `SharedTransaction` and `SharedCommitResult` describe transactional changes and results.
- `LeaseRequest`, `Lease`, `LockRequest` and `AdvisoryLock` describe coordination.
- `ConflictDetail` and `SharedFsError` describe protocol failures.
- `encodeBytes` and `decodeBytes` convert bytes to and from base64.
- `normaliseSharedPath` validates absolute paths.
- `isKernelLocalPath` and `isPersistentPath` classify the namespace; the latter excludes /tmp as well as kernel-local roots.

`GenerationMetadata` is the common identity and generation contract. Nullable fields represent absence internally; for rename, the `unchecked` target version explicitly disables the target-generation check, while null requires the target not to exist.
