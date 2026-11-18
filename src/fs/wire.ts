import { SHARED_FS_SCHEMA, SharedFsError } from "./protocol.js";
import type { AdvisoryLock, ConflictDetail, InodeMetadata, Lease, LeaseRequest, LockRequest, ManifestInode, SharedCommitResult, SharedEntry, SharedKind, SharedOperation, SharedSnapshot, SharedTransaction } from "./protocol.js";

/** JSON data has a closed value grammar; protocol-specific decoders validate its fields. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }

// Decode the JSON grammar directly so an untyped host parser cannot bypass the binary boundary.
class JsonReader {
  private at = 0;
  constructor(private readonly source: string) {}
  private whitespace(): void {
    while (this.at < this.source.length && /[ \t\r\n]/.test(this.source.charAt(this.at))) this.at++;
  }
  private take(s: string): boolean {
    this.whitespace();
    if (!this.source.startsWith(s, this.at)) return false;
    this.at += s.length;
    return true;
  }
  private string(): string {
    this.whitespace();
    const match = /^"((?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*)"/.exec(this.source.slice(this.at));
    if (!match) throw new Error("invalid JSON string");
    this.at += match[0].length;
    const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    return (match[1] ?? "").replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_match: string, code: string) => code.startsWith("u") ? String.fromCharCode(Number.parseInt(code.slice(1), 16)) : escapes[code] ?? "");
  }
  private object(): JsonObject {
    const value: JsonObject = {};
    if (this.take("}")) return value;
    do {
      const key = this.string();
      if (!this.take(":")) throw new Error("invalid JSON member");
      Object.defineProperty(value, key, { value: this.value(), enumerable: true, configurable: true, writable: true });
    } while (this.take(","));
    if (!this.take("}")) throw new Error("invalid JSON object");
    return value;
  }
  private array(): JsonValue[] {
    const value: JsonValue[] = [];
    if (this.take("]")) return value;
    do { value.push(this.value()); } while (this.take(","));
    if (!this.take("]")) throw new Error("invalid JSON array");
    return value;
  }
  private value(): JsonValue {
    this.whitespace();
    if (this.take("{")) return this.object();
    if (this.take("[")) return this.array();
    if (this.source.charAt(this.at) === '"') return this.string();
    if (this.take("true")) return true;
    if (this.take("false")) return false;
    if (this.take("null")) return null;
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.at));
    if (!match) throw new Error("invalid JSON value");
    this.at += match[0].length;
    return Number(match[0]);
  }
  parse(): JsonValue {
    const result = this.value();
    this.whitespace();
    if (this.at !== this.source.length) throw new Error("trailing JSON data");
    return result;
  }
}

export function parseJson(text: string): JsonValue { return new JsonReader(text).parse(); }

// The version-one wire format omits absent fields. Preserve explicit null
// conflict versions, and omit only the unchecked rename-target sentinel.
const omittedNullKeys = new Set(["size", "checksum", "data", "target", "blob", "expectedVersion", "truncate", "mode", "uid", "gid", "path", "imageGeneration", "ttlMs", "detail", "code", "generation"]);
export function wireValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(wireValue);
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === null && omittedNullKeys.has(key)) continue;
    if (key === "expectedTargetVersion" && item === "unchecked") continue;
    Object.defineProperty(result, key, { value: wireValue(item), enumerable: true, writable: true, configurable: true });
  }
  return result;
}

export function record(value: JsonValue): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new SharedFsError("EINVAL", "expected JSON object");
  return value;
}

export function field(value: JsonObject, key: string): JsonValue {
  return Object.hasOwn(value, key) ? value[key] ?? null : null;
}

export function stringField(value: JsonObject, key: string): string {
  const item = field(value, key);
  if (typeof item !== "string") throw new SharedFsError("EINVAL", key + ": expected string");
  return item;
}

export function numberField(value: JsonObject, key: string): number {
  const item = field(value, key);
  if (typeof item !== "number" || !Number.isFinite(item)) throw new SharedFsError("EINVAL", key + ": expected finite number");
  return item;
}

export function booleanField(value: JsonObject, key: string): boolean {
  const item = field(value, key);
  if (typeof item !== "boolean") throw new SharedFsError("EINVAL", key + ": expected boolean");
  return item;
}

export function arrayField(value: JsonObject, key: string): JsonValue[] {
  const item = field(value, key);
  if (!Array.isArray(item)) throw new SharedFsError("EINVAL", key + ": expected array");
  return item;
}

export function optionalNumber(value: JsonObject, key: string): number | null {
  return Object.hasOwn(value, key) ? numberField(value, key) : null;
}

function optionalString(value: JsonObject, key: string): string | null {
  return Object.hasOwn(value, key) ? stringField(value, key) : null;
}

function schema(value: JsonObject): typeof SHARED_FS_SCHEMA {
  if (field(value, "schema") !== SHARED_FS_SCHEMA) throw new SharedFsError("EINVAL", "unsupported filesystem schema");
  return SHARED_FS_SCHEMA;
}

function kind(value: JsonObject): SharedKind {
  const item = field(value, "kind");
  if (item !== "file" && item !== "directory" && item !== "symlink") throw new SharedFsError("EINVAL", "invalid inode kind");
  return item;
}

function metadata(value: JsonObject): InodeMetadata {
  return { kind: kind(value), mode: numberField(value, "mode"), uid: numberField(value, "uid"), gid: numberField(value, "gid"),
    atimeMs: numberField(value, "atimeMs"), mtimeMs: numberField(value, "mtimeMs"), ctimeMs: numberField(value, "ctimeMs"),
    version: numberField(value, "version"), nlink: numberField(value, "nlink") };
}

function readEntry(raw: JsonValue): SharedEntry {
  const value = record(raw);
  const size = optionalNumber(value, "size"), checksum = optionalString(value, "checksum"), data = optionalString(value, "data"), target = optionalString(value, "target");
  return { path: stringField(value, "path"), inode: stringField(value, "inode"), ...metadata(value),
    size, checksum, data, target };
}

export function readManifestInode(raw: JsonValue): ManifestInode {
  const value = record(raw);
  const blob = optionalString(value, "blob"), target = optionalString(value, "target");
  return { id: stringField(value, "id"), ...metadata(value), blob, target };
}

export function readSnapshot(raw: JsonValue): SharedSnapshot {
  const value = record(raw);
  return { schema: schema(value), filesystemId: stringField(value, "filesystemId"), generation: numberField(value, "generation"),
    imageGeneration: numberField(value, "imageGeneration"), committedAt: stringField(value, "committedAt"),
    checksum: stringField(value, "checksum"), entries: arrayField(value, "entries").map(readEntry) };
}

export function readLease(raw: JsonValue): Lease {
  const value = record(raw);
  return { leaseId: stringField(value, "leaseId"), clientId: stringField(value, "clientId"), expiresAt: numberField(value, "expiresAt") };
}

export function readHeartbeat(raw: JsonValue): { ttlMs: number | null } {
  const ttlMs = optionalNumber(record(raw), "ttlMs");
  return { ttlMs };
}

export function readLeaseRequest(raw: JsonValue): LeaseRequest {
  const value = record(raw);
  return { clientId: stringField(value, "clientId"), ...readHeartbeat(value) };
}

export function readLockIntent(raw: JsonValue): Omit<LockRequest, "leaseId"> {
  const value = record(raw);
  return { path: stringField(value, "path"), owner: stringField(value, "owner"), exclusive: booleanField(value, "exclusive"), ...readHeartbeat(value) };
}

export function readLockRequest(raw: JsonValue): LockRequest {
  const value = record(raw);
  return { ...readLockIntent(value), leaseId: stringField(value, "leaseId") };
}

export function readLock(raw: JsonValue): AdvisoryLock {
  const value = record(raw);
  return { ...readLockRequest(value), lockId: stringField(value, "lockId"), expiresAt: numberField(value, "expiresAt") };
}

export function readCommit(raw: JsonValue): SharedCommitResult {
  const value = record(raw);
  return { generation: numberField(value, "generation"), transactionId: stringField(value, "transactionId"), snapshot: readSnapshot(field(value, "snapshot")) };
}

function readCreate(value: JsonObject): SharedOperation {
  const data = optionalString(value, "data"), target = optionalString(value, "target");
  return { op: "create", expectedVersion: optionalNumber(value, "expectedVersion"), path: stringField(value, "path"), kind: kind(value), mode: numberField(value, "mode"),
    uid: numberField(value, "uid"), gid: numberField(value, "gid"), data, target };
}

function readWrite(value: JsonObject): SharedOperation {
  return { op: "write", expectedVersion: optionalNumber(value, "expectedVersion"), path: stringField(value, "path"), offset: numberField(value, "offset"), data: stringField(value, "data"),
    truncate: Object.hasOwn(value, "truncate") ? booleanField(value, "truncate") : null };
}

function readRename(value: JsonObject): SharedOperation {
  // An omitted expected target skips the version check; null explicitly requires the target to be absent.
  const target = field(value, "expectedTargetVersion");
  const expectedTargetVersion = target === null ? null : numberField(value, "expectedTargetVersion");
  return { op: "rename", expectedVersion: optionalNumber(value, "expectedVersion"), from: stringField(value, "from"), to: stringField(value, "to"),
    expectedTargetVersion: Object.hasOwn(value, "expectedTargetVersion") ? expectedTargetVersion : "unchecked" };
}

function readSymlink(value: JsonObject): SharedOperation {
  const mode = optionalNumber(value, "mode"), uid = optionalNumber(value, "uid"), gid = optionalNumber(value, "gid");
  return { op: "symlink", expectedVersion: optionalNumber(value, "expectedVersion"), path: stringField(value, "path"), target: stringField(value, "target"),
    mode, uid, gid };
}

function readPathOperation(value: JsonObject, op: string): SharedOperation {
  const path = stringField(value, "path");
  switch (op) {
    case "truncate": return { op, expectedVersion: optionalNumber(value, "expectedVersion"), path, size: numberField(value, "size") };
    case "unlink": case "rmdir": return { op, expectedVersion: optionalNumber(value, "expectedVersion"), path };
    case "mkdir": return { op, expectedVersion: optionalNumber(value, "expectedVersion"), path, mode: numberField(value, "mode"), uid: numberField(value, "uid"), gid: numberField(value, "gid") };
    case "chmod": return { op, expectedVersion: optionalNumber(value, "expectedVersion"), path, mode: numberField(value, "mode") };
    case "chown": return { op, expectedVersion: optionalNumber(value, "expectedVersion"), path, uid: numberField(value, "uid"), gid: numberField(value, "gid") };
    default: throw new SharedFsError("EINVAL", "unsupported filesystem operation");
  }
}

function readOperationBody(value: JsonObject): SharedOperation {
  const op = stringField(value, "op");
  switch (op) {
    case "create": return readCreate(value);
    case "write": return readWrite(value);
    case "rename": return readRename(value);
    case "symlink": return readSymlink(value);
    case "link": return { op, expectedVersion: optionalNumber(value, "expectedVersion"), from: stringField(value, "from"), to: stringField(value, "to") };
    case "fsync": return { op, expectedVersion: optionalNumber(value, "expectedVersion"), path optionalString(value, "path") };
    default: return readPathOperation(value, op);
  }
}

export function readOperations(value: JsonObject): SharedOperation[] {
  return arrayField(value, "operations").map(raw => readOperationBody(record(raw)));
}

export function readTransaction(raw: JsonValue): SharedTransaction {
  const value = record(raw), imageGeneration = optionalNumber(value, "imageGeneration");
  return { schema: schema(value), transactionId: stringField(value, "transactionId"), clientId: stringField(value, "clientId"),
    leaseId: stringField(value, "leaseId"), baseGeneration: numberField(value, "baseGeneration"), operations: readOperations(value),
    imageGeneration };
}

function conflictValue(value: JsonObject, key: string): number | null {
  return field(value, key) === null ? null : numberField(value, key);
}

function readConflict(raw: JsonValue): ConflictDetail {
  const value = record(raw);
  return { path: stringField(value, "path"), reason: stringField(value, "reason"),
    expected: conflictValue(value, "expected"), actual: conflictValue(value, "actual") };
}

function errorCode(raw: JsonValue): SharedFsError["code"] {
  switch (raw) {
    case "EINVAL": case "ENOENT": case "EEXIST": case "ENOTDIR": case "EISDIR": case "ENOTEMPTY": case "ESTALE": case "ELOCKED": case "EROFS": return raw;
    default: return "EINVAL";
  }
}

export function readHttpError(raw: JsonValue, status: number): SharedFsError {
  const fallback = "shared filesystem HTTP " + status;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return new SharedFsError("EINVAL", fallback);
  const message = field(raw, "message"), code = errorCode(field(raw, "code")), detail = field(raw, "detail");
  const text = typeof message === "string" ? message : fallback;
  return detail === null ? new SharedFsError(code, text) : new SharedFsError(code, text, readConflict(detail));
}
