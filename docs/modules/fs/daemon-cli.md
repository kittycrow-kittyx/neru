# Authority command line

Start a local HTTP authority with a persistent directory:

```sh
npm run fs -- --store /path/to/store --port 8080
```

The entry script accepts host, port, token and seed options. It prints the listening URL and closes the server on SIGINT or SIGTERM.
