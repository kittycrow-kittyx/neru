# Authority client

- `SharedFsClient` defines connection, heartbeat, snapshot, transaction, watch and advisory-lock operations.
- `FetchSharedFsOptions` selects the client identity, bearer token, lease duration and fetch implementation.
- `FetchSharedFsClient` implements that contract using HTTP and retains the current lease. The caller supplies the base generation when committing a transaction.

Call `close()` to release the cached lease.
