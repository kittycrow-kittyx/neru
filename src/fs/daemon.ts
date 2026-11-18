import { parseJson, readSnapshot } from "./wire.js";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AuthoritativeFilesystem } from "./core.js";
import { NodeJournalPersistence } from "./node-persistence.js";
import type { SharedSnapshot } from "./protocol.js";
import { SharedFsHttpServer } from "./server.js";

export interface SharedFsDaemonOptions {
  store: string;
  hostname: string | null;
  port: number | null;
  token: string | null;
  seed: SharedSnapshot | string | null;
}

export interface SharedFsDaemon {
  readonly filesystem: AuthoritativeFilesystem;
  readonly url: URL;
  close(): Promise<void>;
}

const readSeed = async (seed: SharedSnapshot | string | null): Promise<SharedSnapshot | null> => {
  if (!seed) return null;
  if (typeof seed !== "string") return seed;
  return readSnapshot(parseJson(await readFile(resolve(seed), "utf8")));
};

export const startSharedFsDaemon = async (options: SharedFsDaemonOptions): Promise<SharedFsDaemon> => {
  const store = resolve(options.store);
  await mkdir(store, { recursive: true });
  const filesystem = await AuthoritativeFilesystem.open(new NodeJournalPersistence(store));
  const seed = await readSeed(options.seed ?? null);
  if (seed) await filesystem.seed(seed);
  const server = new SharedFsHttpServer(filesystem, {
    maxBodyBytes: null,
    hostname: options.hostname,
    port: options.port,
    token: options.token,
  });
  const listening = await server.listen();
  return { filesystem, url: listening.url, close: listening.close };
};
