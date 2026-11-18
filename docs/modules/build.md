# Build orchestration

- `prepareNeruLiveUserspace(root, options)` runs the userspace installer on the selected root.
- `buildNeruRuntime(options)` invokes the kernel-only runtime builder and verifies readable artefacts.
- `buildNeruImage(options)` builds the optional proof-of-concept initramfs and verifies its runtime artefacts.

These asynchronous functions launch repository shell scripts and propagate build failures.
