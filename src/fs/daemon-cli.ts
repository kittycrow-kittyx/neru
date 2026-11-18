#!/usr/bin/env node
import { optionValue } from "../args.js";
import { startSharedFsDaemon } from "./daemon.js";

const args = process.argv.slice(2);
const option = (name: string): string | null => optionValue(args, name);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    "Usage: neru-fs --store DIR [--host ADDRESS] [--port NUMBER] [--token TOKEN] [--seed SNAPSHOT.json]\n",
  );
  process.exit(0);
}
const store = option("--store") ?? (process.env.MIKUOS_FS_STORE ?? null);
if (!store) throw new Error("neru-fs requires --store DIR or MIKUOS_FS_STORE");
const hostname = option("--host") ?? (process.env.MIKUOS_FS_HOST ?? null);
const portText = option("--port") ?? (process.env.MIKUOS_FS_PORT ?? null);
const token = option("--token") ?? (process.env.MIKUOS_FS_TOKEN ?? null);
const seed = option("--seed");
const daemon = await startSharedFsDaemon({
  store,
  hostname,
  port: portText ? Number(portText) : null,
  token,
  seed,
});
process.stdout.write(`${daemon.url.href}\n`);
let closing = false;
const close = async (): Promise<void> => {
  if (closing) return;
  closing = true;
  await daemon.close();
};
process.once("SIGINT", async () => { await close(); process.exit(130); });
process.once("SIGTERM", async () => { await close(); process.exit(143); });
