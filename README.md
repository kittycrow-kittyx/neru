# NERU

**NERU**: Neru Executes a RUntime.

Neru builds a Linux-WASM kernel and connects its root filesystem to a
host-supplied userspace. The normal runtime contains a kernel, host loaders
and a manifest; the caller supplies the root tree and init executable.

## Build

```sh
git submodule update --init --recursive
npm install
npm run build
npm run build:runtime
```

The default output is `dist/neru-runtime-wasm32_nommu/`, containing
`vmlinux.wasm`, `linux.js`, `linux-worker.js` and `manifest.json`.

## Boot

```sh
bun neru.ts --artifact-root dist/neru-runtime-wasm32_nommu \
  --fs-root /path/to/root --boot --skip-build
```

Linux mounts the root using `mikuosfs`. The default init path is
`/sbin/nemunemu`, which must exist in the supplied filesystem. The current
Linux driver supports metadata, directory enumeration, file reads and
symbolic-link reads. Guest write operations and remote/browser filesystem
transport are incomplete.

An authority endpoint can be configured with `--fs-endpoint URL`. See the
[filesystem contract](docs/SHARED_USERSPACE.md) for the distinction between
implemented host operations and the guest transport.

The separate `--poc-image --userland DIR` mode builds an initramfs for
regression testing. It is not required by the live-root runtime.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Shared filesystem](docs/SHARED_USERSPACE.md)

## Licence

[MIT](LICENSE), except for files with other declarations. See the
[GPL-licensed components](LICENSES/README.md).
