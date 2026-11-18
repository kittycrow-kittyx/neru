import { ensureDirectory } from "./node-path.js";
import { field, numberField, parseJson, record, stringField } from "./wire.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface CheckpointReference {
  schema: 1;
  generation: number;
  path: string;
  checksum: string;
  createdAt: string;
}

export interface CheckpointHooks {
  afterBuild: (() => void | Promise<void>) | null;
  afterVerify: (() => void | Promise<void>) | null;
  beforePublish: (() => void | Promise<void>) | null;
}

const atomicText = async (path: string, text: string): Promise<void> => {
  await ensureDirectory(dirname(path));
  const temporary = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporary, text);
  await rename(temporary, path);
};

export class NodeCheckpointStore {
  readonly checkpoints: string;
  readonly current: string;
  constructor(readonly root: string) {
    this.checkpoints = join(root, "checkpoints");
    this.current = join(root, "CHECKPOINT");
  }

  async selected(): Promise<CheckpointReference | null> {
    try {
      const raw = record(parseJson(await readFile(this.current, "utf8")));
      if (field(raw, "schema") !== 1) return null;
      const value: CheckpointReference = { schema: 1, generation: numberField(raw, "generation"), path: stringField(raw, "path"), checksum: stringField(raw, "checksum"), createdAt: stringField(raw, "createdAt") };
      await stat(value.path);
      return value;
    } catch {
      return null;
    }
  }

  async publish(
    generation: number,
    build: (directory: string) => Promise<{ checksum: string }>,
    verify: (directory: string, checksum: string) => Promise<void>,
    hooks: CheckpointHooks = { afterBuild: null, afterVerify: null, beforePublish: null },
  ): Promise<CheckpointReference> {
    await ensureDirectory(this.checkpoints);
    const temporary = join(this.checkpoints, `.building-${generation}-${randomUUID()}`);
    const final = join(this.checkpoints, `${String(generation).padStart(20, "0")}-${randomUUID()}`);
    await mkdir(temporary, { recursive: false });
    try {
      const built = await build(temporary);
      if (hooks.afterBuild) await hooks.afterBuild();
      await verify(temporary, built.checksum);
      if (hooks.afterVerify) await hooks.afterVerify();
      await rename(temporary, final);
      const reference: CheckpointReference = {
        schema: 1,
        generation,
        path: final,
        checksum: built.checksum,
        createdAt: new Date().toISOString(),
      };
      if (hooks.beforePublish) await hooks.beforePublish();
      await atomicText(this.current, `${JSON.stringify(reference, null, 2)}\n`);
      return reference;
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (error instanceof Error) throw error;
      throw new Error(typeof error === "string" ? error : "checkpoint publication failed");
    }
  }
}
