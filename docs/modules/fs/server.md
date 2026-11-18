# Authority HTTP server

- `SharedFsServerOptions` configures the bind address, port, token and request body limit.
- `SharedFsHttpServer` exposes an existing authority over HTTP. Its `listen()` method returns the listening URL and close callback.

Routes under /v1 cover health, snapshots, watches, seeding, leases, transactions and locks. The server binds to loopback by default.
