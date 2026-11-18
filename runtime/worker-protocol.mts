// SPDX-License-Identifier: GPL-2.0-only

// Host message contracts for the pinned Linux-WASM runtime.
type Word = number | bigint;
interface ExecutableRegion { bin_start: Word; bin_end: Word; data_start: Word; table_start: Word; }
interface InitBase {
  method: "init"; variant: "wasm32_nommu" | "wasm64_nommu";
  vmlinux: WebAssembly.Module; memory: WebAssembly.Memory;
  locks: { serialize: number; _memory: Int32Array };
  last_task: Uint32Array; runner_name: string;
}
export type WorkerRequest = InitBase & (
  | { runner_type: "primary_cpu"; boot_cmdline: string; initrd: ArrayBuffer }
  | { runner_type: "secondary_cpu"; idle_task: Word }
  | { runner_type: "task"; prev_task: Word; new_task: Word; user_executable: ExecutableRegion | null }
);
export type WorkerReply =
  | { method: "start_primary"; init_task: Word }
  | { method: "start_secondary"; cpu: Word; idle_task: Word }
  | { method: "stop_secondary"; cpu: Word }
  | { method: "create_and_run_task"; prev_task: Word; new_task: Word; name: string; user_executable: ExecutableRegion | null }
  | { method: "release_task"; dead_task: Word }
  | { method: "serialize_tasks"; prev_task: Word; next_task: Word }
  | { method: "console_read"; buffer: Word; count: Word; console_read_messenger: Int32Array }
  | { method: "console_write" | "log"; message: string };
export type FilesystemConfig =
  | { kind: "directory"; root: string; clientId: string | null }
  | { kind: "authority"; endpoint: string | null; token: string | null; clientId: string | null };
export interface WorkerBootstrapData { upstreamWorker: string; filesystem: FilesystemConfig | null; }
