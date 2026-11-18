# Filesystem package entry point

Import the public authority interfaces from this module. Implementations reside in the linked modules.

- [Boot policy](boot-policy.md): `decideSharedBoot`.
- [Checkpoint](checkpoint.md): `NodeCheckpointStore`.
- [Client](client.md): `FetchSharedFsClient`, `SharedFsClient`, `FetchSharedFsOptions`.
- [Bridge](bridge.md): `NeruFsBridge`, `NERU_FS_BRIDGE_SCHEMA`, `NeruFsBridgeOptions`, `NeruFsBridgeRequest`, `NeruFsBridgeResponse`.
- [Authority](core.md): `AuthoritativeFilesystem`, `MemoryPersistence`, `snapshotState`, `stateFromSnapshot`.
- [Daemon](daemon.md): `startSharedFsDaemon`, `SharedFsDaemon`, `SharedFsDaemonOptions`.
- [Persistence](node-persistence.md): `NodeJournalPersistence`.
- [Server](server.md): `SharedFsHttpServer`.
- [Protocol](protocol.md): `SHARED_FS_SCHEMA`, `SharedFsError`, `decodeBytes`, `encodeBytes`, `isKernelLocalPath`, `isPersistentPath`, `normaliseSharedPath`.
- Protocol types: `SharedKind`, `InodeMetadata`, `SharedEntry`, `StoredInode`, `ManifestInode`, `SharedSnapshot`, `SharedOperation`, `SharedTransaction`, `SharedCommitResult`, `LeaseRequest`, `Lease`, `LockRequest`, `AdvisoryLock`, `ConflictDetail`, `PERSISTENT_ROOTS`, `KERNEL_LOCAL_ROOTS`.

Additional contracts and defaults: `GenerationMetadata`, `defaultFetchOptions`, `bridgeOptions`.

`StoredState` represents the authority's in-memory generation; `StateManifest` represents its journal metadata and content-addressed inode records. Both share the generation identity contract in [protocol](protocol.md).
