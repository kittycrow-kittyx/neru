# Filesystem authority

- `StoredInode` and `StoredState` describe the in-memory inode table, path map and generation metadata.
- `CommitIntent` records the transaction and generation transition.
- `SharedPersistence` defines asynchronous loading and committing of stored state.
- `MemoryPersistence` provides the in-memory implementation.
- `cloneState` copies the maps and file bytes; `initialState` creates an empty root.
- `snapshotState` serialises state to the wire format; `stateFromSnapshot` restores that representation.
- `AuthoritativeFilesystem` manages leases, inode versions, locks, watches and atomic transaction publication.

Transactions operate on a private state copy before committing to the selected persistence implementation.
