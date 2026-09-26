import fs from "node:fs/promises";
import path from "node:path";
import {
  buildPluginControlUi,
  writePluginBuildManifest,
} from "../src/cli/plugins-control-ui-build.js";
import { controlUiSource } from "../src/plugins/package-manifest.js";
import { copyPluginControlUiAssets } from "./lib/plugin-control-ui-assets.mts";
import { resolveRepoRoot } from "./lib/repo-root.mjs";

const rootDir = process.cwd();
const packageManifest = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const manifest = JSON.parse(await fs.readFile(path.join(rootDir, "openclaw.plugin.json"), "utf8"));
if (process.argv.includes("--copy")) {
  await copyPluginControlUiAssets({
    repoRoot: resolveRepoRoot(import.meta.url),
    pluginRoot: rootDir,
    entry: manifest.controlUi.entry,
  });
} else {
  const source = controlUiSource(packageManifest);
  if (!source) {
    throw new Error("Missing package.json openclaw.controlUi browser entrypoint.");
  }
  manifest.controlUi = await buildPluginControlUi({ rootDir, source });
  await writePluginBuildManifest(rootDir, manifest);
}
