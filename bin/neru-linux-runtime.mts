// SPDX-License-Identifier: GPL-2.0-only

import { optionValue } from "../src/args.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import type { FilesystemConfig, WorkerBootstrapData, WorkerRequest, WorkerReply } from "../runtime/worker-protocol.mts";

const UPSTREAM_LINUX = fileURLToPath(
  new URL("../vendor/linux-wasm/runtime/linux.js", import.meta.url),
);
const UPSTREAM_WORKER = fileURLToPath(
  new URL("../vendor/linux-wasm/runtime/linux-worker.js", import.meta.url),
);
const WORKER_BOOTSTRAP = new URL(
  "../runtime/node-worker-bootstrap.mts",
  import.meta.url,
);

const args = process.argv.slice(2);
const value = (name: string): string | null => optionValue(args, name);

if (args.includes("--help")) {
  process.stdout.write(
    "Usage: neru-linux-runtime --kernel PATH " +
      "[--initramfs PATH] [--variant wasm32_nommu|wasm64_nommu] [--cmdline TEXT]\n" +
      "\n" +
      "The normal NERU path uses no initramfs. Linux mounts mikuosfs as / and " +
      "executes /sbin/nemunemu from the selected live mikuOS root.\n",
  );
  process.exit(0);
}

const kernelPath = value("--kernel");
const initramfsPath = value("--initramfs");
const variant = value("--variant") ?? (process.env.NERU_LINUX_VARIANT ?? null) ?? "wasm32_nommu";
const verbose = (process.env.NERU_VERBOSE ?? null) === "1";
if (!kernelPath) throw new Error("--kernel is required");
if (variant !== "wasm32_nommu" && variant !== "wasm64_nommu") {
  throw new Error(`Unsupported Linux-WASM variant: ${variant}`);
}

const filesystemRoot = (process.env.NERU_FS_ROOT ?? null);
const filesystemEndpoint = (process.env.NERU_FS_ENDPOINT ?? null);
if (!initramfsPath && !filesystemRoot && !filesystemEndpoint) {
  throw new Error(
    "Kernel-only NERU boot requires NERU_FS_ROOT or NERU_FS_ENDPOINT so mikuosfs can mount the live userspace",
  );
}

const filesystem: FilesystemConfig | null = initramfsPath
  ? null
  : filesystemRoot
    ? {
        kind: "directory",
        root: filesystemRoot,
        clientId: process.env.NERU_FS_CLIENT_ID ?? null,
      }
    : {
        kind: "authority",
        endpoint: filesystemEndpoint ?? null,
        token: process.env.NERU_FS_TOKEN ?? null,
        clientId: process.env.NERU_FS_CLIENT_ID ?? null,
      };

const workers = new Set<NodeWorker>();

type MessageHandler = (event: { data: WorkerReply }) => void;
type ErrorHandler = (error: Error) => void;

class WorkerAdapter {
  #worker: NodeWorker;
  #onmessage: MessageHandler | null = null;
  #onmessageerror: ErrorHandler | null = null;
  #onerror: ErrorHandler | null = null;

  constructor(_url: string | URL, options: { name: string | null } = { name: null }) {
    this.#worker = new NodeWorker(WORKER_BOOTSTRAP, {
      ...(options.name == null ? {} : { name: options.name }),
      workerData: {
        upstreamWorker: UPSTREAM_WORKER,
        filesystem,
      } satisfies WorkerBootstrapData,
    });

    workers.add(this.#worker);
    this.#worker.once("exit", () => workers.delete(this.#worker));
    this.#worker.on("message", (data: WorkerReply) => { if (this.#onmessage) this.#onmessage({ data }); });
    this.#worker.on("messageerror", (error: Error) => { if (this.#onmessageerror) this.#onmessageerror(error); });
    this.#worker.on("error", (error) => {
      if (shuttingDown) return;
      if (this.#onerror) this.#onerror(error);
      else throw error;
    });
  }

  set onmessage(handler: MessageHandler | null) { this.#onmessage = handler; }
  set onmessageerror(handler: ErrorHandler | null) { this.#onmessageerror = handler; }
  set onerror(handler: ErrorHandler | null) { this.#onerror = handler; }
  postMessage(message: WorkerRequest) { this.#worker.postMessage(message); }
  terminate() {
    workers.delete(this.#worker);
    return this.#worker.terminate();
  }
}

Object.defineProperty(globalThis, "Worker", {
  configurable: true,
  value: WorkerAdapter,
});
Object.defineProperty(globalThis, "confirm", {
  configurable: true,
  value: () => false,
});

const SHUTDOWN_PREFIX = "\u001b]777;neru-shutdown=";
const SHUTDOWN_TERMINATOR = "\u0007";

let raw = false;
let shuttingDown = false;
let pendingConsole = "";

const restoreTerminal = () => {
  if (raw && process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    raw = false;
  }
};

const longestShutdownPrefixSuffix = (value: string): number => {
  const maximum = Math.min(value.length, SHUTDOWN_PREFIX.length - 1);

  for (let length = maximum; length > 0; length -= 1) {
    if (SHUTDOWN_PREFIX.startsWith(value.slice(-length))) return length;
  }

  return 0;
};

const stopLinux = async (requestedStatus: number): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;

  const status = Number.isInteger(requestedStatus)
    && requestedStatus >= 0
    && requestedStatus <= 255
    ? requestedStatus
    : 1;

  restoreTerminal();
  process.stdin.pause();
  process.stdin.removeAllListeners("data");

  process.stderr.write(
    `neru: mikuOS exited with status ${status}; stopping Linux\n`,
  );

  const activeWorkers = [...workers];
  await Promise.allSettled(
    activeWorkers.map((worker) => worker.terminate()),
  );

  process.exit(status);
};

const flushUnmarkedConsole = (): void => {
  // Retain a partial marker so a shutdown sequence split across worker messages is still recognised.
  const retained = longestShutdownPrefixSuffix(pendingConsole);
  const visibleEnd = pendingConsole.length - retained;
  if (visibleEnd > 0) process.stdout.write(pendingConsole.slice(0, visibleEnd));
  pendingConsole = pendingConsole.slice(visibleEnd);
};

// A shutdown marker can span worker messages; emit only the confirmed console bytes and stop on a complete valid marker.
const writeGuestConsole = (message: string): void => {
  if (shuttingDown) return;

  pendingConsole += String(message);

  while (pendingConsole.length > 0) {
    const markerStart = pendingConsole.indexOf(SHUTDOWN_PREFIX);

    if (markerStart < 0) {
      flushUnmarkedConsole();
      return;
    }

    if (markerStart > 0) {
      process.stdout.write(pendingConsole.slice(0, markerStart));
      pendingConsole = pendingConsole.slice(markerStart);
    }

    const markerEnd = pendingConsole.indexOf(
      SHUTDOWN_TERMINATOR,
      SHUTDOWN_PREFIX.length,
    );

    if (markerEnd < 0) return;

    const completeMarker = pendingConsole.slice(0, markerEnd + 1);
    const statusText = pendingConsole.slice(
      SHUTDOWN_PREFIX.length,
      markerEnd,
    );

    pendingConsole = pendingConsole.slice(markerEnd + 1);

    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(statusText)) {
      process.stdout.write(completeMarker);
      continue;
    }

    stopLinux(Number.parseInt(statusText, 10)).catch((error: Error) => { process.stderr.write(error.message); process.exit(1); });
    return;
  }
};

process.once("exit", restoreTerminal);
process.once("SIGTERM", () => {
  restoreTerminal();
  process.exit(143);
});

const upstreamSource = await readFile(UPSTREAM_LINUX, "utf8");
Object.defineProperty(globalThis, "__neruLinux", { value: null, writable: true, configurable: true });
const launch = new Function(`${upstreamSource}\n;globalThis.__neruLinux = linux;\n//# sourceURL=${UPSTREAM_LINUX}`) as () => void;
launch();
const globals = globalThis as typeof globalThis & { __neruLinux: LinuxLauncher | null };
const linuxValue = globals.__neruLinux;
Reflect.deleteProperty(globals, "__neruLinux");
if (typeof linuxValue !== "function") {
  throw new Error("Pinned Linux-WASM runtime did not expose its Linux launcher");
}

type LinuxLauncher = (
  worker: string, variant: "wasm32_nommu" | "wasm64_nommu", kernel: WebAssembly.Module,
  commandLine: string, initramfs: ArrayBuffer, diagnostic: (message: string) => void,
  consoleOutput: (message: string) => void,
) => Promise<{ key_input(value: string): void }>;
const linux = linuxValue;
const kernelBytes = Uint8Array.from(await readFile(kernelPath));
const initramfs = initramfsPath
  ? Uint8Array.from(await readFile(initramfsPath)).buffer
  : new ArrayBuffer(0);
const kernel = await WebAssembly.compile(kernelBytes);
const commandLine = value("--cmdline") ?? (
  initramfsPath
    ? "maxcpus=1 root=/dev/ram0 rootfstype=ramfs init=/init console=hvc console=ttyS0"
    : "maxcpus=1 root=mikuos rootfstype=mikuosfs rw init=/sbin/nemunemu console=hvc console=ttyS0"
);

process.stderr.write(
  initramfsPath
    ? `neru: booting Linux (${variant}) with the legacy proof-of-concept initramfs\n`
    : `neru: booting Linux (${variant}) directly from the live mikuOS userspace\n`,
);
const machine = await linux(
  UPSTREAM_WORKER,
  variant,
  kernel,
  commandLine,
  initramfs,
  (message: string) => {
    if (verbose) process.stderr.write(`neru: ${message}\n`);
  },
  writeGuestConsole,
);

process.once("SIGINT", () => machine.key_input("\u0003"));

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  raw = true;
}
process.stdin.resume();
process.stdin.on("data", (chunk) => {
  machine.key_input(Buffer.from(chunk).toString("utf8"));
});
