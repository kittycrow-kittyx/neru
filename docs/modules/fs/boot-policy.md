# Shared filesystem boot policy

- `MissingSharedPolicy` selects failure, a read-only checkpoint or recovery when the authority is unavailable.
- `SharedBootDecision` identifies the boot mode, generation and write policy.
- `decideSharedBoot` accepts the selected image generation and optional authority snapshot; it returns the boot decision or throws in failure mode.

The decision does not construct a filesystem or mutate either generation.
