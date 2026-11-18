import { FetchSharedFsClient } from "./client.js";
import type { SharedFsClient } from "./client.js";
import { SharedFsError } from "./protocol.js";
import type { AdvisoryLock, ConflictDetail, Lease, LockRequest, SharedCommitResult, SharedOperation, SharedSnapshot } from "./protocol.js";
import { field, numberField, optionalNumber, parseJson, readLockIntent, readOperations, record, stringField } from "./wire.js";

export const NERU_FS_BRIDGE_SCHEMA = 1 as const;

export type NeruFsBridgeRequest =
  | { schema: 1; id: string; method: "connect" }
  | { schema: 1; id: string; method: "heartbeat" }
  | { schema: 1; id: string; method: "snapshot" }
  | { schema: 1; id: string; method: "commit"; baseGeneration: number; imageGeneration?: number; operations: SharedOperation[] }
  | { schema: 1; id: string; method: "lock"; request: Omit<LockRequest, "leaseId"> }
  | { schema: 1; id: string; method: "unlock"; lockId: string };

export type NeruFsBridgeResponse =
  | { schema: 1; id: string; ok: true; value: Lease | SharedSnapshot | SharedCommitResult | AdvisoryLock | { ok: true } }
  | { schema: 1; id: string; ok: false; error: { name: string; message: string; code?: string; detail?: ConflictDetail } };

export interface NeruFsBridgeOptions {
  endpoint: string | URL;
  token?: string;
  clientId?: string;
  fetcher?: typeof fetch;
}

function readRequest(value: import("./wire.js").JsonObject, id: string): NeruFsBridgeRequest {
  if (field(value, "schema") !== NERU_FS_BRIDGE_SCHEMA) throw new SharedFsError("EINVAL", "unsupported NERU filesystem bridge schema");
  const method = stringField(value, "method");
  switch (method) {
    case "connect": case "heartbeat": case "snapshot": return { schema: 1, id, method };
    case "commit": {
      const imageGeneration = optionalNumber(value, "imageGeneration");
      return { schema: 1, id, method, baseGeneration: numberField(value, "baseGeneration"), operations: readOperations(value), ...(imageGeneration !== null ? { imageGeneration } : {}) };
    }
    case "lock": return { schema: 1, id, method, request: readLockIntent(field(value, "request")) };
    case "unlock": return { schema: 1, id, method, lockId: stringField(value, "lockId") };
    default: throw new SharedFsError("EINVAL", "unsupported filesystem bridge method");
  }
}

export class NeruFsBridge {
  readonly client: SharedFsClient;
  constructor(options: NeruFsBridgeOptions | SharedFsClient) {
    this.client = "snapshot" in options
      ? options
      : new FetchSharedFsClient(options.endpoint, {
          ...(options.token ? { token: options.token } : {}),
          ...(options.clientId ? { clientId: options.clientId } : {}),
          ...(options.fetcher ? { fetcher: options.fetcher } : {}),
        });
  }

  async call(request: NeruFsBridgeRequest): Promise<NeruFsBridgeResponse> {
    try {
      if (request.schema !== NERU_FS_BRIDGE_SCHEMA) throw new Error("unsupported NERU filesystem bridge schema");
      let value: Lease | SharedSnapshot | SharedCommitResult | AdvisoryLock | { ok: true } = { ok: true };
      switch (request.method) {
        case "connect": value = await this.client.connect(); break;
        case "heartbeat": value = await this.client.heartbeat(); break;
        case "snapshot": value = await this.client.snapshot(); break;
        case "commit": value = await this.client.commit(request.operations, request.baseGeneration, request.imageGeneration); break;
        case "lock": value = await this.client.acquireLock(request.request); break;
        case "unlock": await this.client.releaseLock(request.lockId); value = { ok: true }; break;
      }
      return { schema: 1, id: request.id, ok: true, value };
    } catch (error) {
      const source = error instanceof Error ? error : new Error(String(error));
      const protocolError = source instanceof SharedFsError ? source : null;
      return {
        schema: 1,
        id: request.id,
        ok: false,
        error: {
          name: source.name ?? "Error",
          message: source.message ?? String(error),
          ...(protocolError ? { code: protocolError.code } : {}),
          ...(protocolError?.detail ? { detail: protocolError.detail } : {}),
        },
      };
    }
  }

  async json(request: string): Promise<string> {
    let id = "invalid";
    try {
      const parsed = record(parseJson(request));
      id = stringField(parsed, "id");
      return JSON.stringify(await this.call(readRequest(parsed, id)));
    } catch (error) {
      return JSON.stringify({
        schema: 1,
        id,
        ok: false,
        error: { name: "SyntaxError", message: error instanceof Error ? error.message : String(error), code: "EINVAL" },
      } satisfies NeruFsBridgeResponse);
    }
  }
}
