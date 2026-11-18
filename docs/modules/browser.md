# Browser runtime

- `NeruBrowserBootOptions` supplies artefact URLs, filesystem connection settings and injectable browser runtime functions.
- `NeruBrowserBootPlan` records the resolved URLs, variant and kernel command line.
- `planNeruBrowserBoot` resolves the plan without booting a machine.
- `loadNeruLinuxBrowserRuntime` loads the pinned upstream browser launcher from its URL.
- `NeruLinuxBrowserRuntime` is the launcher contract.
- `bootNeruBrowser` requires cross-origin isolation and shared memory, loads the kernel and starts the launcher.
- `NeruBrowserMachine` exposes the keyboard input and termination interface.

The remote guest filesystem transport is separate from these host boot functions.

`defaultBrowserBootOptions()` constructs the explicit defaults; callers can spread these and override the required settings.
