# Neru package entry point

- [Build](build.md): `buildNeruImage`, `buildNeruRuntime`, `prepareNeruLiveUserspace`.
- [Terminal runtime](runtime.md): `artifactPaths`, `bootNeru`, `neruVariant`, `planNeruBoot`, `probeNeru`, `resolveArtifactRoot`, `resolveLinuxRuntime`.
- [Browser](browser.md): `bootNeruBrowser`, `loadNeruLinuxBrowserRuntime`, `planNeruBrowserBoot`, `NeruBrowserBootOptions`, `NeruBrowserBootPlan`, `NeruBrowserMachine`, `NeruLinuxBrowserRuntime`.
- [Runtime types](types.md): `NeruArtifactPaths`, `NeruBootOptions`, `NeruBootPlan`, `NeruBuildOptions`, `NeruPocImageBuildOptions`, `NeruProbeResult`, `NeruRuntimeBuildOptions`, `NeruVariant`.

## Filesystem exports

- [Boot policy](fs/boot-policy.md): `decideSharedBoot`.
- [Checkpoint](fs/checkpoint.md): `NodeCheckpointStore`.
- [Client](fs/client.md): `FetchSharedFsClient`, `SharedFsClient`, `FetchSharedFsOptions`.
- [Bridge](fs/bridge.md): `NeruFsBridge`, `NERU_FS_BRIDGE_SCHEMA`, `NeruFsBridgeOptions`, `NeruFsBridgeRequest`, `NeruFsBridgeResponse`.
- [Authority](fs/core.md): `AuthoritativeFilesystem`, `MemoryPersistence`, `snapshotState`, `stateFromSnapshot`.
- [Daemon](fs/daemon.md): `startSharedFsDaemon`, `SharedFsDaemon`, `SharedFsDaemonOptions`.
- [Persistence](fs/node-persistence.md): `NodeJournalPersistence`.
- [Server](fs/server.md): `SharedFsHttpServer`.
- [Protocol](fs/protocol.md): `SHARED_FS_SCHEMA`, `SharedFsError`, `decodeBytes`, `encodeBytes`, `isKernelLocalPath`, `isPersistentPath`, `normaliseSharedPath`.
- Protocol types: `SharedKind`, `InodeMetadata`, `SharedEntry`, `StoredInode`, `ManifestInode`, `SharedSnapshot`, `SharedOperation`, `SharedTransaction`, `SharedCommitResult`, `LeaseRequest`, `Lease`, `LockRequest`, `AdvisoryLock`, `ConflictDetail`, `PERSISTENT_ROOTS`, `KERNEL_LOCAL_ROOTS`.

Default input factories: `defaultBootOptions`, `defaultBuildOptions` and `defaultBrowserBootOptions`.
