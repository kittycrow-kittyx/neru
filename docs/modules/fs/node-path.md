# Node directory creation

`ensureDirectory(path)` creates missing parents, verifies an existing path is a directory, and propagates other host failures. It uses the non-recursive Node mkdir contract, which returns no data.
