# Terminal runtime

- `neruPackageRoot` returns the repository root from the source or compiled module location.
- `neruVariant` validates the selected Linux-WASM variant.
- `resolveArtifactRoot` and `artifactPaths` select the runtime directory and construct its file paths.
- `resolveLinuxRuntime` selects the host launcher.
- `planNeruBoot` constructs the process arguments and environment.
- `probeNeru` verifies access to the executable and selected kernel files.
- `bootNeru` starts the launcher with inherited standard streams and resolves its exit status.

A kernel-only boot plan has a null initramfs path.
