import { parseJson, readCommit, readHttpError, readLease, readLock, readSnapshot, wireValue } from "./wire.js";
import type { JsonValue } from "./wire.js";
import { SHARED_FS_SCHEMA } from "./protocol.js";
import type {
  AdvisoryLock,
  Lease,
  LockRequest,
  SharedCommitResult,
  SharedOperation,
  SharedSnapshot,
  SharedTransaction,
} from "./protocol.js";

const randomId = (): string => {
  const uuid = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function" ? globalThis.crypto.randomUUID() : null;
  if (uuid) return uuid;
  const bytes = new Uint8Array(16);
  if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  if (!bytes.some(Boolean)) {
    for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
};

export interface SharedFsClient {
  readonly clientId: string;
  connect(): Promise<Lease>;
  heartbeat(): Promise<Lease>;
  close(): Promise<void>;
  snapshot(): Promise<SharedSnapshot>;
  commit(operations: SharedOperation[], baseGeneration: number): Promise<SharedCommitResult>;
  commit(operations: SharedOperation[], baseGeneration: number, imageGeneration: number | null): Promise<SharedCommitResult>;
  watch(after: number): Promise<SharedSnapshot | null>;
  watch(after: number, timeoutMs: number): Promise<SharedSnapshot | null>;
  acquireLock(request: Omit<LockRequest, "leaseId">): Promise<AdvisoryLock>;
  releaseLock(lockId: string): Promise<void>;
}

export interface FetchSharedFsOptions {
  clientId: string | null;
  token: string | null;
  fetcher: typeof fetch | null;
  leaseTtlMs: number | null;
}

export function defaultFetchOptions(): FetchSharedFsOptions {
  return { clientId: null, token: null, fetcher: null, leaseTtlMs: null };
}

export class FetchSharedFsClient implements SharedFsClient {
  readonly clientId: string;
  private readonly fetcher: typeof fetch;
  private lease: Lease | null = null;

  constructor(readonly base: string | URL, private readonly options: FetchSharedFsOptions = defaultFetchOptions()) {
    this.clientId = options.clientId ?? randomId();
    this.fetcher = options.fetcher ?? fetch;
  }

  async connect(): Promise<Lease> {
    if (this.lease && this.lease.expiresAt > Date.now() + 1_000) return { ...this.lease };
    this.lease = await this.request("/v1/leases", readLease, {
      method: "POST",
      body: JSON.stringify(wireValue({ clientId: this.clientId, ttlMs: this.options.leaseTtlMs })),
    });
    return { ...this.lease };
  }

  async heartbeat(): Promise<Lease> {
    const lease = await this.requireLease();
    this.lease = await this.request(`/v1/leases/${encodeURIComponent(lease.leaseId)}/heartbeat`, readLease, {
      method: "POST",
      body: JSON.stringify(wireValue({ ttlMs: this.options.leaseTtlMs })),
    });
    return { ...this.lease };
  }

  async close(): Promise<void> {
    if (!this.lease) return;
    const lease = this.lease;
    this.lease = null;
    await this.request(`/v1/leases/${encodeURIComponent(lease.leaseId)}`, () => {}, { method: "DELETE", body: null });
  }

  snapshot(): Promise<SharedSnapshot> {
    return this.request("/v1/snapshot", readSnapshot);
  }

  async commit(operations: SharedOperation[], baseGeneration: number, imageGeneration: number | null = null): Promise<SharedCommitResult> {
    const lease = await this.requireLease();
    const transaction: SharedTransaction = {
      schema: SHARED_FS_SCHEMA,
      transactionId: randomId(),
      clientId: this.clientId,
      leaseId: lease.leaseId,
      baseGeneration,
      imageGeneration,
      operations,
    };
    return this.request("/v1/transactions", readCommit, {
      method: "POST",
      body: JSON.stringify(wireValue(parseJson(JSON.stringify(transaction)))),
    });
  }

  watch(after: number, timeoutMs = 30_000): Promise<SharedSnapshot | null> {
    return this.request(`/v1/watch?after=${after}&timeout=${timeoutMs}`, value => value === null ? null : readSnapshot(value));
  }

  async acquireLock(request: Omit<LockRequest, "leaseId">): Promise<AdvisoryLock> {
    const lease = await this.requireLease();
    return this.request("/v1/locks", readLock, {
      method: "POST",
      body: JSON.stringify(wireValue(parseJson(JSON.stringify({ ...request, leaseId: lease.leaseId })))),
    });
  }

  async releaseLock(lockId: string): Promise<void> {
    const lease = await this.requireLease();
    await this.request(`/v1/locks/${encodeURIComponent(lockId)}?lease=${encodeURIComponent(lease.leaseId)}`, () => {}, { method: "DELETE", body: null });
  }

  private async requireLease(): Promise<Lease> {
    if (!this.lease || this.lease.expiresAt <= Date.now() + 1_000) return await this.connect();
    return this.lease;
  }

  private url(path: string): URL {
    const root = this.base instanceof URL ? this.base : new URL(this.base);
    return new URL(path.replace(/^\//, ""), root.href.endsWith("/") ? root : new URL(`${root.href}/`));
  }

  private async request<T>(path: string, decode: (value: JsonValue) => T, init: { method: "GET" | "POST" | "DELETE"; body: string | null } = { method: "GET", body: null }): Promise<T> {
    const headers = new Headers();
    headers.set("accept", "application/json");
    if (init.body !== null) headers.set("content-type", "application/json");
    if (this.options.token) headers.set("authorization", `Bearer ${this.options.token}`);
    const response = await this.fetcher(this.url(path), { ...init, headers, cache: "no-store" });
    const text = await response.text();
    const payload = text ? parseJson(text) : null;
    if (!response.ok) throw readHttpError(payload, response.status);
    return decode(payload);
  }
}
