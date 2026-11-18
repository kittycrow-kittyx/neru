# Checkpoint selection

- `CheckpointReference` identifies the generation, directory and checksum of a checkpoint.
- `CheckpointHooks` supplies optional callbacks between build, verification and publication.
- `NodeCheckpointStore.selected()` returns the selected reference if its directory exists.
- `NodeCheckpointStore.publish()` builds and verifies a temporary directory before replacing the CHECKPOINT marker.

An unsuccessful publication preserves the previous marker.
