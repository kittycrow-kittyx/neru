# Authority lifecycle

- `SharedFsDaemonOptions` configures the store directory, network address, token and optional seed.
- `startSharedFsDaemon` opens journal persistence, optionally seeds the authority and binds its HTTP server.
- `SharedFsDaemon` returns the filesystem instance, listening URL and asynchronous close callback.

The store directory is created if necessary.
