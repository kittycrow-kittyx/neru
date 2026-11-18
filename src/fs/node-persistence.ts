import { ensureDirectory } from "./node-path.js";
import { arrayField, field, numberField, parseJson, readManifestInode, record, stringField, wireValue } from "./wire.js";
import type { JsonValue } from "./wire.js";
import { createHash, randomUUID } from "node:crypto";
import { open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SHARED_FS_SCHEMA } from "./protocol.js";
import type { ManifestInode, StateManifest } from "./protocol.js";
import { cloneState } from "./core.js";
import type { CommitIntent, SharedPersistence, StoredInode, StoredState } from "./core.js";


export type CommitStage = "after-intent" | "after-blobs" | "after-manifest" | "after-current" | "after-complete";

export interface NodePersistenceOptions {
  crashAt: CommitStage | null;
  onStage: ((stage: CommitStage) => void | Promise<void>) | null;
}

const json = (value: StateManifest | (CommitIntent & { schema: 1 }) | { schema: 1; generation: number } | { schema: 1; generation: number; checksum: string } | { schema: 1; generation: number; transactionId: string; completedAt: string }): string => `${JSON.stringify(wireValue(parseJson(JSON.stringify(value))), null, 2)}\n`;
const sha256 = (value: Uint8Array | string): string => createHash("sha256").update(value).digest("hex");
const manifestName = (generation: number): string => `${String(generation).padStart(20, "0")}.json`;

const fsyncFile = async (path: string): Promise<void> => {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
};

const fsyncDirectory = async (path: string): Promise<void> => {
  try {
    const handle = await open(path, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    // Filesystems may reject directory sync even when file sync and atomic rename work.
    const code = error instanceof Error ? ((error as NodeJS.ErrnoException).code ?? null) : null;
    if (code === "EINVAL" || code === "ENOTSUP" || code === "EOPNOTSUPP" || code === "EISDIR" || code === "EBADF") return;
    if (process.platform === "win32" && (code === "EPERM" || code === "EACCES")) return;
    if (error instanceof Error) throw error;
    throw new Error(typeof error === "string" ? error : "non-Error filesystem failure");
  }
};

const writeAtomic = async (path: string, value: string | Uint8Array): Promise<void> => {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, value);
  await fsyncFile(temporary);
  await rename(temporary, path);
  await fsyncDirectory(dirname(path));
};

const exists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true; } catch (error) {
    if (error instanceof Error && ((error as NodeJS.ErrnoException).code ?? null) === "ENOENT") return false;
    if (error instanceof Error) throw error;
    throw new Error(typeof error === "string" ? error : "non-Error filesystem failure");
  }
};

function pathPair(value: JsonValue): [string, string] {
  if (!Array.isArray(value)) throw new Error("invalid manifest path pair");
  const path = value[0] ?? null, inode = value[1] ?? null;
  if (value.length !== 2 || typeof path !== "string" || typeof inode !== "string") throw new Error("invalid manifest path pair");
  return [path, inode];
}

function decodeManifest(raw: JsonValue): StateManifest {
  const value = record(raw);
  if (field(value, "schema") !== SHARED_FS_SCHEMA) throw new Error("invalid manifest schema");
  return { schema: SHARED_FS_SCHEMA, filesystemId: stringField(value, "filesystemId"), generation: numberField(value, "generation"),
    imageGeneration: numberField(value, "imageGeneration"), committedAt: stringField(value, "committedAt"), nextInode: numberField(value, "nextInode"),
    paths: arrayField(value, "paths").map(pathPair), inodes: arrayField(value, "inodes").map(readManifestInode), checksum: stringField(value, "checksum") };
}

export class NodeJournalPersistence implements SharedPersistence {
  readonly generations: string;
  readonly blobs: string;
  readonly journal: string;
  readonly current: string;

  constructor(readonly root: string, private readonly options: NodePersistenceOptions = { crashAt: null, onStage: null }) {
    this.generations = join(root, "generations");
    this.blobs = join(root, "blobs");
    this.journal = join(root, "journal");
    this.current = join(root, "CURRENT");
  }

  async load(): Promise<StoredState | null> {
    await this.prepare();
    const selected = await this.currentGeneration() ?? await this.latestValidGeneration();
    if (selected === null) return null;
    const state = await this.readGeneration(selected);
    if (!state) throw new Error(`shared filesystem generation ${selected} failed validation`);
    if (!(await this.currentGeneration()) || (await this.currentGeneration()) !== selected) {
      await writeAtomic(this.current, json({ schema: 1, generation: selected }));
    }
    return state;
  }

  async commit(intent: CommitIntent, state: StoredState): Promise<void> {
    await this.prepare();
    if (state.generation !== intent.nextGeneration) throw new Error("generation and intent disagree");
    const intentPath = join(this.journal, `${intent.transactionId}.intent.json`);
    const completePath = join(this.journal, `${intent.transactionId}.complete.json`);
    await writeAtomic(intentPath, json({ schema: 1, ...intent }));
    await this.stage("after-intent");

    const manifest = await this.writeBlobsAndManifest(state);
    await this.stage("after-blobs");

    const generationPath = join(this.generations, manifestName(state.generation));
    await writeAtomic(generationPath, json(manifest));
    await this.stage("after-manifest");

    // CURRENT is the commit marker. Before this rename the previous generation remains authoritative.
    await writeAtomic(this.current, json({ schema: 1, generation: state.generation, checksum: manifest.checksum }));
    await this.stage("after-current");

    await writeAtomic(completePath, json({
      schema: 1,
      transactionId: intent.transactionId,
      generation: state.generation,
      completedAt: new Date().toISOString(),
    }));
    await rm(intentPath, { force: true });
    await this.stage("after-complete");
  }

  private async prepare(): Promise<void> {
    await Promise.all([
      ensureDirectory(this.root),
      ensureDirectory(this.generations),
      ensureDirectory(this.blobs),
      ensureDirectory(this.journal),
    ]);
    for (const directory of [this.root, this.generations, this.blobs, this.journal]) {
      for (const name of await readdir(directory)) {
        if (name.includes(".tmp-")) await rm(join(directory, name), { recursive: true, force: true });
      }
    }
  }

  private async stage(stage: CommitStage): Promise<void> {
    if (this.options.onStage) await this.options.onStage(stage);
    if (this.options.crashAt === stage) throw new Error(`simulated crash at ${stage}`);
  }

  private async persistBlob(inode: StoredInode): Promise<string | null> {
    if (inode.kind !== "file") return null;
    const data = inode.data ?? new Uint8Array();
    const blob = sha256(data);
    const path = join(this.blobs, blob);
    if (!(await exists(path))) await writeAtomic(path, data);
    return blob;
  }

  private async writeBlobsAndManifest(state: StoredState): Promise<StateManifest> {
    // Content-addressed files are durable before the manifest refers to them; sort entries for reproducible checksums.
    const inodes: ManifestInode[] = [];
    for (const inode of [...state.inodes.values()].sort((a, b) => a.id.localeCompare(b.id, [], { numeric: true }))) {
      const blob = await this.persistBlob(inode);
      inodes.push({
        id: inode.id,
        kind: inode.kind,
        mode: inode.mode,
        uid: inode.uid,
        gid: inode.gid,
        atimeMs: inode.atimeMs,
        mtimeMs: inode.mtimeMs,
        ctimeMs: inode.ctimeMs,
        version: inode.version,
        nlink: inode.nlink,
        blob,
        target: inode.kind === "symlink" ? inode.target ?? "" : null,
      });
    }
    const payload = {
      schema: SHARED_FS_SCHEMA,
      filesystemId: state.filesystemId,
      generation: state.generation,
      imageGeneration: state.imageGeneration,
      committedAt: state.committedAt,
      nextInode: state.nextInode,
      paths: [...state.paths.entries()].sort(([a], [b]) => a.localeCompare(b)),
      inodes,
    };
    return { ...payload, checksum: sha256(JSON.stringify(wireValue(parseJson(JSON.stringify(payload))))) };
  }

  private async currentGeneration(): Promise<number | null> {
    try {
      const value = record(parseJson(await readFile(this.current, "utf8")));
      const generation = field(value, "generation");
      return field(value, "schema") === 1 && typeof generation === "number" && Number.isSafeInteger(generation) && generation >= 0 ? generation : null;
    } catch (error) {
      if (error instanceof Error && ((error as NodeJS.ErrnoException).code ?? null) === "ENOENT") return null;
      return null;
    }
  }

  private async latestValidGeneration(): Promise<number | null> {
    const candidates = (await readdir(this.generations))
      .filter(name => /^\d{20}\.json$/.test(name))
      .map(name => Number(name.slice(0, 20)))
      .sort((a, b) => b - a);
    for (const generation of candidates) if (await this.readGeneration(generation)) return generation;
    return null;
  }

  private async readBlob(inode: ManifestInode): Promise<Uint8Array | null> {
    if (inode.kind !== "file") return null;
    if (!inode.blob) throw new Error("file inode has no content hash");
    const data = Uint8Array.from(await readFile(join(this.blobs, inode.blob)));
    if (sha256(data) !== inode.blob) throw new Error("file inode checksum does not match");
    return data;
  }

  private async readGeneration(generation: number): Promise<StoredState | null> {
    try {
      const raw = record(parseJson(await readFile(join(this.generations, manifestName(generation)), "utf8")));
      const checksum = field(raw, "checksum");
      const payload = { ...raw };
      delete payload.checksum;
      if (sha256(JSON.stringify(payload)) !== checksum) return null;
      const manifest = decodeManifest(raw);
      if (manifest.generation !== generation) return null;
      const inodes = new Map<string, StoredInode>();
      for (const inode of manifest.inodes) {
        const data = await this.readBlob(inode);
        inodes.set(inode.id, {
          id: inode.id,
          kind: inode.kind,
          mode: inode.mode,
          uid: inode.uid,
          gid: inode.gid,
          atimeMs: inode.atimeMs,
          mtimeMs: inode.mtimeMs,
          ctimeMs: inode.ctimeMs,
          version: inode.version,
          nlink: inode.nlink,
          data,
          target: inode.kind === "symlink" ? inode.target ?? "" : null,
        });
      }
      const state: StoredState = {
        schema: SHARED_FS_SCHEMA,
        filesystemId: manifest.filesystemId,
        generation: manifest.generation,
        imageGeneration: manifest.imageGeneration,
        committedAt: manifest.committedAt,
        nextInode: manifest.nextInode,
        paths: new Map(manifest.paths),
        inodes,
      };
      return cloneState(state);
    } catch {
      return null;
    }
  }
}
