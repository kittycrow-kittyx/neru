import { optionValue } from "./src/args.js";
import {
  artifactPaths,
  buildNeruImage,
  buildNeruRuntime,
  bootNeru,
  prepareNeruLiveUserspace,
  probeNeru,
} from "./src/index.js";

const args = process.argv.slice(2);

const option = (name: string): string | null => optionValue(args, name);

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(
    "Usage: bun neru.ts --fs-root DIR [--boot]\n" +
    "       bun neru.ts --fs-endpoint URL [--boot]\n" +
    "       bun neru.ts --artifact-root DIR --fs-root DIR --boot --skip-build\n" +
    "       bun neru.ts --artifact-root DIR --probe\n" +
    "       bun neru.ts --poc-image --userland DIR [--output DIR] [--boot]\n" +
    "\n" +
    "Normal live-root launches automatically prepare the selected mikuOS root\n" +
    "and reuse current NEMUNEMU, BusyBox and Linux-WASM artefacts.\n" +
    "\n" +
    "The default build contains only vmlinux.wasm and its host runtime. Linux\n" +
    "mounts the selected mikuOS root as mikuosfs and starts /sbin/nemunemu.\n" +
    "Use --poc-image only to reproduce the original embedded-userspace test.\n",
  );
  process.exit(0);
}

const variant = option("--variant");
if (variant !== null && variant !== "wasm32_nommu" && variant !== "wasm64_nommu") throw new Error(`Unsupported Linux-WASM variant: ${variant}`);

const userland = option("--userland") ?? process.env.NERU_USERLAND;
const output =
  option("--output")
  ?? option("--artifact-root")
  ?? process.env.NERU_ARTIFACT_ROOT;

const workspace = option("--workspace");
const filesystemRoot = option("--fs-root");
const filesystemEndpoint = option("--fs-endpoint");
const skipBuild = args.includes("--skip-build");
const pocImage = args.includes("--poc-image");

let artifactRoot = output;

if (!skipBuild && !pocImage && filesystemRoot) {
  await prepareNeruLiveUserspace(filesystemRoot, {
    ...(variant ? { variant } : {}),
    ...(workspace ? { workspace } : {}),
  });
}

if (!skipBuild) {
  const common = {
    ...(output ? { output } : {}),
    ...(variant ? { variant } : {}),
    ...(workspace ? { workspace } : {}),
    rebuildLinux: args.includes("--rebuild-linux"),
  };

  const artefacts = pocImage
    ? await buildNeruImage({
        ...common,
        userland: userland ?? (() => {
          throw new Error("--poc-image requires --userland DIR");
        })(),
      })
    : await buildNeruRuntime(common);

  artifactRoot = artefacts.root;

  process.stdout.write(
    pocImage
      ? `NERU proof-of-concept image: ${artefacts.root}\n`
      : `NERU kernel-only runtime: ${artefacts.root}\n`,
  );
}

const filesystemToken = option("--fs-token");
const filesystemClientId = option("--fs-client-id");
const bootOptions = {
  ...(artifactRoot ? { artifactRoot } : {}),
  ...(pocImage && artifactRoot
    ? { initramfs: artifactPaths(artifactRoot).initramfs }
    : {}),
  ...(filesystemRoot ? { filesystemRoot } : {}),
  ...(filesystemEndpoint ? { filesystemEndpoint } : {}),
  ...(filesystemToken ? { filesystemToken } : {}),
  ...(filesystemClientId ? { filesystemClientId } : {}),
};

if (args.includes("--probe")) {
  const result = await probeNeru(bootOptions);
  process.stdout.write(`Linux runtime: ${result.executable}\n`);
  process.stdout.write(`Linux kernel: ${result.kernel}\n`);
  process.stdout.write(
    result.initramfs
      ? `Proof-of-concept initramfs: ${result.initramfs}\n`
      : "Initramfs: none\n",
  );
}
if (!args.includes("--probe") && args.includes("--boot")) {
  process.exitCode = await bootNeru(bootOptions);
}
