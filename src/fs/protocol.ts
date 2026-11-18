export const SHARED_FS_SCHEMA = 1 as const;
export const PERSISTENT_ROOTS = ["/etc", "/home", "/opt", "/root", "/usr", "/var"] as const;
export const KERNEL_LOCAL_ROOTS = ["/dev", "/proc", "/sys", "/run"] as const;

export type SharedKind = "file" | "directory" | "symlink";

export interface InodeMetadata {
  kind: SharedKind;
  mode: number;
  uid: number;
  gid: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  version: number;
  nlink: number;
}

export interface SharedEntry extends InodeMetadata {
  path: string;
  inode: string;
  size: number | null;
  checksum: string | null;
  data: string | null;
  target: string | null;
}

export interface StoredInode extends InodeMetadata {
  id: string;
  data: Uint8Array | null;
  target: string | null;
}

export interface ManifestInode extends InodeMetadata {
  id: string;
  blob: string | null;
  target: string | null;
}

export interface GenerationMetadata {
  schema: typeof SHARED_FS_SCHEMA;
  filesystemId: string;
  generation: number;
  imageGeneration: number;
  committedAt: string;
}

export interface SharedSnapshot extends GenerationMetadata {
  checksum: string;
  entries: SharedEntry[];
}

interface ExpectedVersion {
  expectedVersion: number | null;
}

export type SharedOperation =
  | ({ op: "create"; path: string; kind: SharedKind; mode: number; uid: number; gid: number; data: string | null; target: string | null } & ExpectedVersion)
  | ({ op: "write"; path: string; offset: number; data: string; truncate: boolean | null } & ExpectedVersion)
  | ({ op: "truncate"; path: string; size: number } & ExpectedVersion)
  | ({ op: "rename"; from: string; to: string; expectedTargetVersion: number | null | "unchecked" } & ExpectedVersion)
  | ({ op: "unlink"; path: string } & ExpectedVersion)
  | ({ op: "mkdir"; path: string; mode: number; uid: number; gid: number } & ExpectedVersion)
  | ({ op: "rmdir"; path: string } & ExpectedVersion)
  | ({ op: "chmod"; path: string; mode: number } & ExpectedVersion)
  | ({ op: "chown"; path: string; uid: number; gid: number } & ExpectedVersion)
  | ({ op: "link"; from: string; to: string } & ExpectedVersion)
  | ({ op: "symlink"; path: string; target: string; mode: number | null; uid: number | null; gid: number | null } & ExpectedVersion)
  | ({ op: "fsync"; path: string | null } & ExpectedVersion);

export interface SharedTransaction {
  schema: typeof SHARED_FS_SCHEMA;
  transactionId: string;
  clientId: string;
  leaseId: string;
  baseGeneration: number;
  imageGeneration: number | null;
  operations: SharedOperation[];
}

export interface SharedCommitResult {
  generation: number;
  transactionId: string;
  snapshot: SharedSnapshot;
}

export interface LeaseRequest {
  clientId: string;
  ttlMs: number | null;
}

export interface Lease {
  leaseId: string;
  clientId: string;
  expiresAt: number;
}

export interface LockRequest {
  path: string;
  leaseId: string;
  owner: string;
  exclusive: boolean;
  ttlMs: number | null;
}

export interface AdvisoryLock extends LockRequest {
  lockId: string;
  expiresAt: number;
}

export interface ConflictDetail {
  path: string;
  expected: number | null;
  actual: number | null;
  reason: string;
}

export class SharedFsError extends Error {
  constructor(
    readonly code: "EINVAL" | "ENOENT" | "EEXIST" | "ENOTDIR" | "EISDIR" | "ENOTEMPTY" | "ESTALE" | "ELOCKED" | "EROFS",
    message: string,
    readonly detail: ConflictDetail | null = null,
  ) {
    super(message);
    this.name = "SharedFsError";
  }
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export const encodeBytes = (bytes: Uint8Array): string => {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    output += alphabet.charAt((value >>> 18) & 63);
    output += alphabet.charAt((value >>> 12) & 63);
    output += index + 1 < bytes.length ? alphabet.charAt((value >>> 6) & 63) : "=";
    output += index + 2 < bytes.length ? alphabet.charAt(value & 63) : "=";
  }
  return output;
};

export const decodeBytes = (value: string | null = null): Uint8Array => {
  if (!value) return new Uint8Array();
  const clean = value.replace(/\s+/g, "");
  if (clean.length % 4 !== 0) throw new SharedFsError("EINVAL", "invalid base64 payload");
  const output: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const chars = clean.slice(index, index + 4);
    const numbers = [...chars].map(char => char === "=" ? 0 : alphabet.indexOf(char));
    if (numbers.some(number => number < 0)) throw new SharedFsError("EINVAL", "invalid base64 payload");
    const a = numbers[0] ?? null, b = numbers[1] ?? null, c = numbers[2] ?? null, d = numbers[3] ?? null;
    if (a == null || b == null || c == null || d == null) throw new SharedFsError("EINVAL", "incomplete base64 quartet");
    const packed = (a << 18) | (b << 12) | (c << 6) | d;
    output.push((packed >>> 16) & 255);
    if (chars.charAt(2) !== "=") output.push((packed >>> 8) & 255);
    if (chars.charAt(3) !== "=") output.push(packed & 255);
  }
  return Uint8Array.from(output);
};

export const normaliseSharedPath = (value: string): string => {
  if (!value.startsWith("/")) throw new SharedFsError("EINVAL", `path is not absolute: ${value}`);
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new SharedFsError("EINVAL", `path escapes the shared root: ${value}`);
    if (part.includes("\0")) throw new SharedFsError("EINVAL", "path contains NUL");
    parts.push(part);
  }
  return parts.length ? `/${parts.join("/")}` : "/";
};

export const isKernelLocalPath = (value: string): boolean => {
  const path = normaliseSharedPath(value);
  return KERNEL_LOCAL_ROOTS.some(root => path === root || path.startsWith(`${root}/`));
};

export const isPersistentPath = (value: string): boolean => {
  const path = normaliseSharedPath(value);
  return !isKernelLocalPath(path) && path !== "/tmp" && !path.startsWith("/tmp/");
};
