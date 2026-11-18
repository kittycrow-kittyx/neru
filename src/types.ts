export type NeruVariant = "wasm32_nommu" | "wasm64_nommu";

export interface NeruArtifactPaths {
  root: string;
  kernel: string;
  /** Present only for the legacy embedded-userspace proof-of-concept image. */
  initramfs: string;
  browserRuntime: string;
  browserWorker: string;
  manifest: string;
}

export interface NeruRuntimeBuildOptions {
  output: string | null;
  variant: NeruVariant | null;
  workspace: string | null;
  rebuildLinux: boolean | null;
}

export interface NeruPocImageBuildOptions extends NeruRuntimeBuildOptions {
  userland: string;
}

/** @deprecated Use NeruPocImageBuildOptions for the legacy embedded-userspace image. */
export type NeruBuildOptions = NeruPocImageBuildOptions;

export interface NeruBootOptions {
  artifactRoot: string | null;
  linuxRuntime: string | null;
  kernel: string | null;
  /** Explicitly set only when reproducing the legacy proof-of-concept image. */
  initramfs: string | null;
  argv: string[] | null;
  environment: Record<string, string> | null;
  /** Exact local mikuOS root selected by the Thistle/Teto host. */
  filesystemRoot: string | null;
  /** Optional remote or shared authority endpoint. */
  filesystemEndpoint: string | null;
  filesystemToken: string | null;
  filesystemClientId: string | null;
}

export interface NeruBootPlan {
  executable: string;
  argv: string[];
  environment: Record<string, string>;
  kernel: string;
  initramfs: string | null;
}

export interface NeruProbeResult {
  executable: string;
  kernel: string;
  initramfs: string | null;
}

/** Explicit defaults for kernel build inputs. */
export function defaultBuildOptions(): NeruRuntimeBuildOptions {
  return { output: null, variant: null, workspace: null, rebuildLinux: false };
}

/** Explicit defaults for a live-root boot. */
export function defaultBootOptions(): NeruBootOptions {
  return { artifactRoot: null, linuxRuntime: null, kernel: null, initramfs: null, argv: null, environment: null, filesystemRoot: null, filesystemEndpoint: null, filesystemToken: null, filesystemClientId: null };
}
