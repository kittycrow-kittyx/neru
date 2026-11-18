// SPDX-License-Identifier: GPL-2.0-only

import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const ERRNO = Object.freeze({
  EACCES: -13,
  EIO: -5,
  ELOOP: -40,
  ENAMETOOLONG: -36,
  ENOENT: -2,
  ENOTDIR: -20,
  EPERM: -1,
});

const decoder = new TextDecoder("utf-8");

type GuestWord = number | bigint;

const errorCode = (error: Error): number => {
  const code = (error as NodeJS.ErrnoException).code ?? null;
  return typeof code === "string" && Object.hasOwn(ERRNO, code)
    ? ERRNO[code as keyof typeof ERRNO] : ERRNO.EIO;
};

const cstring = (memory: WebAssembly.Memory, pointerValue: GuestWord) => {
  const pointer = Number(pointerValue);
  const bytes = new Uint8Array(memory.buffer);
  let end = pointer;
  while (end < bytes.length && (bytes[end] ?? 0) !== 0) end++;
  if (end === bytes.length) {
    throw Object.assign(new Error("unterminated guest path"), { code: "ENAMETOOLONG" });
  }
  return decoder.decode(bytes.subarray(pointer, end));
};

const writeBytes = (memory: WebAssembly.Memory, pointerValue: GuestWord, capacityValue: GuestWord, source: Uint8Array) => {
  const pointer = Number(pointerValue);
  const capacity = Number(capacityValue);
  if (source.length >= capacity) return ERRNO.ENAMETOOLONG;
  const target = new Uint8Array(memory.buffer, pointer, capacity);
  target.set(source);
  target[source.length] = 0;
  return source.length;
};

const inside = (root: string, candidate: string) =>
  candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

export function createNodeMikuosFs(rootValue: string) {
  const root = realpathSync.native(resolve(rootValue));
  const encoder = new TextEncoder();

  const lexical = (guestPath: string) => {
    if (!guestPath.startsWith("/") || guestPath.includes("\0")) {
      throw Object.assign(new Error("invalid guest path"), { code: "EACCES" });
    }
    const candidate = resolve(root, `.${guestPath}`);
    if (!inside(root, candidate)) {
      throw Object.assign(new Error("guest path escapes root"), { code: "EACCES" });
    }
    return candidate;
  };

  const finalPath = (guestPath: string) => {
    const candidate = lexical(guestPath);
    const resolved = realpathSync.native(candidate);
    if (!inside(root, resolved)) {
      throw Object.assign(new Error("guest symlink escapes root"), { code: "EACCES" });
    }
    return resolved;
  };

  const lstatPath = (guestPath: string) => {
    const candidate = lexical(guestPath);
    if (candidate === root) return candidate;
    const parent = realpathSync.native(dirname(candidate));
    if (!inside(root, parent)) {
      throw Object.assign(new Error("guest parent escapes root"), { code: "EACCES" });
    }
    return candidate;
  };

  const guestLink = (target: string) => {
    if (!isAbsolute(target)) return target;
    const resolved = resolve(target);
    if (!inside(root, resolved)) return target;
    const guest = relative(root, resolved).split(sep).join("/");
    return guest ? `/${guest}` : "/";
  };

  const read = (memory: WebAssembly.Memory, pathPointer: GuestWord, offsetValue: GuestWord, bufferPointer: GuestWord, countValue: GuestWord): number => {
    let descriptor: number | null = null;
    try {
      const path = finalPath(cstring(memory, pathPointer));
      const offset = Number(offsetValue);
      const count = Number(countValue);
      if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(count) || count < 0) {
        return ERRNO.EIO;
      }
      descriptor = openSync(path, "r");
      const target = new Uint8Array(memory.buffer, Number(bufferPointer), count);
      return readSync(descriptor, target, 0, count, offset);
    } catch (error) {
      return error instanceof Error ? errorCode(error) : ERRNO.EIO;
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  };

  const readdir = (memory: WebAssembly.Memory, pathPointer: GuestWord, indexValue: GuestWord, bufferPointer: GuestWord, countValue: GuestWord): number => {
    try {
      const path = finalPath(cstring(memory, pathPointer));
      const index = Number(indexValue);
      const entries = readdirSync(path, { encoding: "utf8" })
        .filter((name) => name !== ".thistle-meta.json" && name !== ".thistle-meta.json.tmp")
        .sort();
      if (!Number.isSafeInteger(index) || index < 0) return ERRNO.EIO;
      const entry = entries[index] ?? null;
      if (entry == null) return 0;
      return writeBytes(
        memory,
        bufferPointer,
        countValue,
        encoder.encode(entry),
      );
    } catch (error) {
      return error instanceof Error ? errorCode(error) : ERRNO.EIO;
    }
  };

  return Object.freeze({
    mode(memory: WebAssembly.Memory, pathPointer: GuestWord) {
      try {
        return Number(lstatSync(lstatPath(cstring(memory, pathPointer))).mode);
      } catch (error) {
        return error instanceof Error ? errorCode(error) : ERRNO.EIO;
      }
    },

    size(memory: WebAssembly.Memory, pathPointer: GuestWord) {
      try {
        return BigInt(lstatSync(lstatPath(cstring(memory, pathPointer))).size);
      } catch (error) {
        return BigInt(error instanceof Error ? errorCode(error) : ERRNO.EIO);
      }
    },

    read,
    readdir,

    readlink(memory: WebAssembly.Memory, pathPointer: GuestWord, bufferPointer: GuestWord, countValue: GuestWord) {
      try {
        const path = lstatPath(cstring(memory, pathPointer));
        return writeBytes(
          memory,
          bufferPointer,
          countValue,
          encoder.encode(guestLink(readlinkSync(path, "utf8"))),
        );
      } catch (error) {
        return error instanceof Error ? errorCode(error) : ERRNO.EIO;
      }
    },
  });
}
