// SPDX-License-Identifier: GPL-2.0-only

import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInThisContext } from "node:vm";
import { parentPort, workerData } from "node:worker_threads";
import { createNodeMikuosFs } from "./node-mikuosfs.mts";
import type { WorkerBootstrapData, WorkerRequest, WorkerReply } from "./worker-protocol.mts";

const port = parentPort;
if (!port) throw new Error("NERU Linux worker has no parent port");
const data: WorkerBootstrapData = workerData;
if (typeof data !== "object" || data === null || !("upstreamWorker" in data) || typeof data.upstreamWorker !== "string" || !data.upstreamWorker) {
  throw new Error("NERU Linux worker was not given the pinned upstream worker path");
}

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

const upstreamWorker = data.upstreamWorker;
const filesystemConfig = "filesystem" in data ? data.filesystem ?? null : null;
const filesystem = filesystemConfig !== null && typeof filesystemConfig === "object" &&
  "kind" in filesystemConfig && filesystemConfig.kind === "directory" &&
  "root" in filesystemConfig && typeof filesystemConfig.root === "string"
  ? createNodeMikuosFs(filesystemConfig.root)
  : null;

Object.defineProperty(globalThis, "__neruFilesystemConfig", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: filesystemConfig,
});
Object.defineProperty(globalThis, "__neruFsSync", {
  configurable: false,
  enumerable: false,
  writable: false,
  value: filesystem,
});

type MessageHandler = (event: { data: WorkerRequest }) => void;
type ErrorHandler = (error: Error) => void;
let onmessage: MessageHandler | null = null;
let onmessageerror: ErrorHandler | null = null;
const pending: WorkerRequest[] = [];

const selfShim = {
  postMessage(message: WorkerReply) {
    port.postMessage(message);
  },
};

Object.defineProperty(selfShim, "onmessage", {
  get: () => onmessage,
  set: (handler: MessageHandler | null) => {
    onmessage = handler;
    while (onmessage && pending.length) {
      const data = pending.shift();
      if (data) onmessage({ data });
    }
  },
});

Object.defineProperty(selfShim, "onmessageerror", {
  get: () => onmessageerror,
  set: (handler: ErrorHandler | null) => {
    onmessageerror = handler;
  },
});

Object.defineProperty(globalThis, "self", {
  configurable: true,
  value: selfShim,
});

port.on("message", (data: WorkerRequest) => {
  if (onmessage) onmessage({ data });
  else pending.push(data);
});
port.on("messageerror", (error) => {
  if (onmessageerror) onmessageerror(error);
  else throw error;
});

const marker = "    // Host callbacks used by the Wasm-default console driver.";
const hooks = `    // Host callbacks used by NERU's built-in mikuosfs driver.\n\n` +
`    wasm_mikuosfs_mode: (path) =>\n` +
`      globalThis.__neruFsSync ? globalThis.__neruFsSync.mode(memory, path) : -19,\n\n` +
`    wasm_mikuosfs_size: (path) =>\n` +
`      globalThis.__neruFsSync ? globalThis.__neruFsSync.size(memory, path) : -19n,\n\n` +
`    wasm_mikuosfs_read: (path, offset, buffer, count) =>\n` +
`      globalThis.__neruFsSync\n` +
`        ? globalThis.__neruFsSync.read(memory, path, offset, buffer, count)\n` +
`        : -19,\n\n` +
`    wasm_mikuosfs_readdir: (path, index, buffer, count) =>\n` +
`      globalThis.__neruFsSync\n` +
`        ? globalThis.__neruFsSync.readdir(memory, path, index, buffer, count)\n` +
`        : -19,\n\n` +
`    wasm_mikuosfs_readlink: (path, buffer, count) =>\n` +
`      globalThis.__neruFsSync\n` +
`        ? globalThis.__neruFsSync.readlink(memory, path, buffer, count)\n` +
`        : -19,\n\n`;

const upstream = await readFile(upstreamWorker, "utf8");
if (!upstream.includes(marker)) {
  throw new Error("Pinned Linux-WASM worker no longer exposes the expected driver hook marker");
}
const source = upstream.replace(marker, hooks + marker);
runInThisContext(source, { filename: upstreamWorker });
