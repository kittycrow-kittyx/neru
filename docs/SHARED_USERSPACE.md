# Shared filesystem

A filesystem authority supplies a root tree to clients. The kernel-only
runtime requires a root; the normal artefact carries neither persistent user
data nor an initramfs.

## Linux interface

The default command line includes:

```text
root=mikuos rootfstype=mikuosfs rw init=/sbin/nemunemu
```

The `rw` request describes the intended mount configuration, not the current
write support. `kernel/mikuosfs.c` exposes metadata, directory enumeration,
file reads and symbolic links. `runtime/node-mikuosfs.mts` implements the
local directory callbacks. The built-in driver is read-only at present.

The Node launch path accepts a local directory. The CLI and browser can carry
an authority endpoint, but the complete remote/browser operation bridge and
guest mutation path are not implemented.

## Authority protocol

The TypeScript authority in `src/fs/` models persistent changes as operation
transactions. Durable commits record intent, content and metadata, and advance
`CURRENT` to a new generation. Per-inode versions detect conflicting writes;
incomplete generations are ignored on recovery.

The protocol covers creation, reads, writes, truncation, rename, removal,
directories, ownership, permissions, links, fsync and advisory locks. Leases
allow abandoned locks to expire. These are authority operations, not a list
of implemented Linux filesystem callbacks.

`src/fs/boot-policy.ts` defines failure, read-only checkpoint and recovery
policies when the authority is missing. The normal policy fails rather than
creating a separate writable tree.

## Init

The supplied root must contain `/sbin/nemunemu` for the default boot command.
Linux launches it as init. The runtime does not embed that executable.
