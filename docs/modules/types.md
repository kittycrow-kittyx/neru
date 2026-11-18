# Runtime contracts

- `NeruVariant`: Linux-WASM NOMMU target width.
- `NeruArtifactPaths`: paths for the kernel, host runtime, worker, manifest and optional initramfs.
- `NeruRuntimeBuildOptions`: output, workspace, variant and rebuild selection.
- `NeruPocImageBuildOptions`: build options with the userspace path.
- `NeruBuildOptions`: legacy alias for the proof-of-concept options.
- `NeruBootOptions`: host executable, kernel, filesystem and environment options.
- `NeruBootPlan`: selected executable, arguments and environment.
- `NeruProbeResult`: verified host executable and artefact paths.

`defaultBuildOptions()` and `defaultBootOptions()` return fully specified default inputs, with missing paths represented by null.
