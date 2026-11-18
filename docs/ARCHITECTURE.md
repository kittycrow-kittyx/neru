# Architecture

Neru integrates a pinned Linux-WASM kernel with terminal and browser hosts.
Its normal build produces the kernel, JavaScript runtime, worker and manifest.

```text
host-supplied root tree
          |
     host callbacks
          |
  Linux mikuosfs driver
          |
      Linux VFS
          |
    init and processes
```

The built-in `mikuosfs` driver forwards metadata, directory enumeration, file
reads and symbolic-link reads to host callbacks. The Node worker supplies
these callbacks for a local directory. The root tree contains the init
executable and its dependencies.

`src/fs/` implements the shared-filesystem authority and transaction protocol.
The remote and browser authority configuration is separate from the local
synchronous callbacks; the complete guest transport is not implemented.
See [shared filesystem](SHARED_USERSPACE.md) for the contract.

The default init path is `/sbin/nemunemu`. Nemunemu supplies THX execution
and the guest syscall translation in userspace. Linux startup and root
mounting belong to Neru.

The optional `--poc-image` build packages a root and initramfs for regression
testing. The normal kernel-only runtime uses a live root instead.
