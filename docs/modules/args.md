# CLI option values

`optionValue(args, name)` reads a long option from the argument array without mutating it.

- `--name=value` takes precedence over `--name value`.
- A missing value returns `null`.
- The caller validates the option's meaning.
