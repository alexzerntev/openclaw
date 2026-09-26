import fs from "node:fs/promises";
import path from "node:path";
import { collectSourceCheckoutPluginBuildEntries } from "./bundled-plugin-build-entries.mjs";

/** Copies the immutable browser build into its root-dist plugin package. */
export async function copyPluginControlUiAssets(params: {
  repoRoot: string;
  pluginRoot: string;
  entry: string;
  env?: NodeJS.ProcessEnv;
}) {
  const pluginDir = path.relative(path.join(params.repoRoot, "extensions"), params.pluginRoot);
  if (!pluginDir || pluginDir.includes(path.sep) || pluginDir.startsWith(".")) {
    throw new Error("Bundled UI copy must run inside one bundled plugin package.");
  }
  const output = path.posix.dirname(params.entry);
  if (!/^dist\/control-ui\/[a-f0-9]{64}$/u.test(output)) {
    throw new Error("Build the plugin's immutable Control UI assets before copying.");
  }
  const buildEntry = collectSourceCheckoutPluginBuildEntries({
    cwd: params.repoRoot,
    env: params.env,
  }).find(({ id }) => id === pluginDir);
  if (!buildEntry) {
    return;
  }
  const runtimeRoot = path.join(params.repoRoot, "dist/extensions", pluginDir);
  // Isolated package builds stage dist contents here and retire their package-local dist.
  // Keep that staging source so repeated copy phases can restore the manifest's layout.
  const source = buildEntry.isolated
    ? path.join(runtimeRoot, output.slice("dist/".length))
    : path.join(params.pluginRoot, output);
  await fs.cp(source, path.join(runtimeRoot, output), { recursive: true });
}
