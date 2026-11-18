# Durable generations

- `CommitStage` identifies the journal boundaries used by crash simulation.
- `NodePersistenceOptions` configures the stage callback and optional simulated failure.
- `NodeJournalPersistence` implements the persistence contract with content-addressed blobs, generation manifests, intent records and a CURRENT marker.
- `load()` validates the selected manifest and its blobs; `commit()` publishes the next generation.

This implementation uses file sync and atomic rename for publication.
