import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";

/** Create missing parent directories using the non-recursive host primitive. */
export async function ensureDirectory(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path && !(await directoryExists(parent))) await ensureDirectory(parent);
  try { await mkdir(path); }
  catch (error) {
    if (error instanceof Error && ((error as NodeJS.ErrnoException).code ?? null) === "EEXIST" && (await stat(path)).isDirectory()) return;
    if (error instanceof Error) throw error;
    throw new Error("directory creation failed");
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); }
  catch (error) {
    if (error instanceof Error && ((error as NodeJS.ErrnoException).code ?? null) === "ENOENT") return false;
    if (error instanceof Error) throw error;
    throw new Error("directory lookup failed");
  }
}
