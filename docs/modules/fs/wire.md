# JSON protocol decoders

- `JsonValue`, `JsonObject`, `parseJson`: JSON grammar and parser.
- `record`, `field`, `stringField`, `numberField`, `booleanField`, `arrayField`, `optionalNumber`: validated field access.
- `readSnapshot`, `readManifestInode`: snapshot and persisted inode validation.
- `readLease`, `readLeaseRequest`, `readHeartbeat`, `readLockIntent`, `readLockRequest`, `readLock`: coordination messages.
- `readOperations`, `readTransaction`, `readCommit`: transaction decoder and result.
- `readHttpError`: convert an HTTP failure payload to a filesystem error.

Malformed fields raise a filesystem error. Omitted optional fields remain absent; explicit null target versions retain their conflict-check semantics.
