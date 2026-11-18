# Filesystem message bridge

- `NERU_FS_BRIDGE_SCHEMA` identifies the message version.
- `NeruFsBridgeRequest` and `NeruFsBridgeResponse` define correlated requests and success/error responses.
- `NeruFsBridgeOptions` selects the authority endpoint and HTTP client settings.
- `NeruFsBridge` accepts either options or an existing filesystem client. Its `call` method dispatches typed operations; `json` wraps that interface in a JSON exchange.

The bridge exposes authority operations to host consumers.

`bridgeOptions(endpoint)` returns connection defaults for the given endpoint.
