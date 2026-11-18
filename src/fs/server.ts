import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { SharedFsError } from "./protocol.js";
import type { AdvisoryLock, ConflictDetail, Lease, SharedCommitResult, SharedSnapshot } from "./protocol.js";
import { parseJson, readHeartbeat, readLeaseRequest, readLockRequest, readSnapshot, readTransaction, wireValue } from "./wire.js";
import type { JsonValue } from "./wire.js";
import type { AuthoritativeFilesystem } from "./core.js";

export interface SharedFsServerOptions {
  hostname: string | null;
  port: number | null;
  token: string | null;
  maxBodyBytes: number | null;
}

const send = (response: ServerResponse, status: number, value: SharedSnapshot | Lease | AdvisoryLock | SharedCommitResult | { ok: boolean; generation: number | null } | { code: string; message: string; detail: ConflictDetail | null } | null): void => {
  const body = status === 204 ? "" : `${JSON.stringify(wireValue(parseJson(JSON.stringify(value))))}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  });
  response.end(body);
};

const body = async (request: IncomingMessage, limit: number): Promise<JsonValue> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer | string>) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) throw new SharedFsError("EINVAL", "request body is too large");
    chunks.push(bytes);
  }
  return size ? parseJson(Buffer.concat(chunks).toString("utf8")) : {};
};

export class SharedFsHttpServer {
  private server: Server | null = null;
  constructor(readonly filesystem: AuthoritativeFilesystem, readonly options: SharedFsServerOptions = { hostname: null, port: null, token: null, maxBodyBytes: null }) {}

  async listen(): Promise<{ url: URL; close(): Promise<void> }> {
    if (this.server) throw new Error("shared filesystem server is already running");
    const server = createServer(async (request, response) => { await this.route(request, response); });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.options.port ?? 0, this.options.hostname ?? "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("shared filesystem server has no TCP address");
    const url = new URL(`http://${address.address.includes(":") ? `[${address.address}]` : address.address}:${address.port}/`);
    return {
      url,
      close: async () => {
        if (!this.server) return;
        const active = this.server;
        this.server = null;
        await new Promise<void>((resolve, reject) => active.close(error => error ? reject(error) : resolve()));
      },
    };
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if ((request.method ?? "") === "OPTIONS") { send(response, 204, null); return; }
      if (this.options.token && (request.headers.authorization ?? null) !== `Bearer ${this.options.token}`) {
        send(response, 401, { code: "EINVAL", message: "unauthorised", detail: null });
        return;
      }
      const url = new URL(request.url ?? "/", "http://shared.invalid");
      const limit = this.options.maxBodyBytes ?? 64 * 1024 * 1024;
      if (await this.routeStatic(request, response, url, limit)) return;
      if (await this.routeDynamic(request, response, url, limit)) return;
      send(response, 404, { code: "ENOENT", message: "not found", detail: null });
    } catch (error) {
      if (error instanceof SharedFsError) {
        send(response, error.code === "ESTALE" || error.code === "ELOCKED" ? 409 : 400, {
          code: error.code,
          message: error.message,
          detail: error.detail,
        });
      } else {
        send(response, 500, { code: "EINVAL", message: error instanceof Error ? error.message : (typeof error === "string" ? error : "non-Error exception"), detail: null });
      }
    }
  }

  private async routeStatic(request: IncomingMessage, response: ServerResponse, url: URL, limit: number): Promise<boolean> {
    switch (`${(request.method ?? "")} ${url.pathname}`) {
      case "GET /v1/health":
        send(response, 200, { ok: true, generation: this.filesystem.snapshot().generation }); return true;
      case "GET /v1/snapshot":
        send(response, 200, this.filesystem.snapshot()); return true;
      case "GET /v1/watch": {
        const after = Number(url.searchParams.get("after") ?? 0);
        const timeout = Number(url.searchParams.get("timeout") ?? 30_000);
        send(response, 200, await this.filesystem.watch(after, timeout)); return true;
      }
      case "POST /v1/seed":
        send(response, 200, await this.filesystem.seed(readSnapshot(await body(request, limit)))); return true;
      case "POST /v1/leases":
        send(response, 201, this.filesystem.createLease(readLeaseRequest(await body(request, limit)))); return true;
      case "POST /v1/transactions":
        send(response, 200, await this.filesystem.commit(readTransaction(await body(request, limit)))); return true;
      case "POST /v1/locks":
        send(response, 201, this.filesystem.acquireLock(readLockRequest(await body(request, limit)))); return true;
      default: return false;
    }
  }

  private async routeDynamic(request: IncomingMessage, response: ServerResponse, url: URL, limit: number): Promise<boolean> {
    const heartbeat = (/^\/v1\/leases\/([^/]+)\/heartbeat$/.exec(url.pathname) ?? [])[1] ?? null;
    if ((request.method ?? "") === "POST" && heartbeat) {
      const value = readHeartbeat(await body(request, limit));
      send(response, 200, this.filesystem.heartbeat(decodeURIComponent(heartbeat), value.ttlMs));
      return true;
    }
    const lease = (/^\/v1\/leases\/([^/]+)$/.exec(url.pathname) ?? [])[1] ?? null;
    if ((request.method ?? "") === "DELETE" && lease) {
      this.filesystem.releaseLease(decodeURIComponent(lease));
      send(response, 200, { ok: true, generation: null });
      return true;
    }
    const lock = (/^\/v1\/locks\/([^/]+)$/.exec(url.pathname) ?? [])[1] ?? null;
    if ((request.method ?? "") === "DELETE" && lock) {
      this.filesystem.releaseLock(decodeURIComponent(lock), url.searchParams.get("lease") ?? "");
      send(response, 200, { ok: true, generation: null });
      return true;
    }
    return false;
  }
}
