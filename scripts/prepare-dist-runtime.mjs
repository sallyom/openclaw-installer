import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const distDir = join(repoRoot, "dist");
const distServerDir = join(distDir, "server");
const distCompatServerDir = join(distDir, "src", "server");
const providerPluginsDir = join(repoRoot, "provider-plugins");
const distProviderPluginsDir = join(distDir, "provider-plugins");
const deployerAssetsDir = join(repoRoot, "src", "server", "deployers", "assets");
const distDeployerAssetsDir = join(distServerDir, "deployers", "assets");

function resetDir(target) {
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
}

function copyDirIfPresent(source, target) {
  if (!existsSync(source)) return;
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, { recursive: true });
}

copyDirIfPresent(deployerAssetsDir, distDeployerAssetsDir);

if (existsSync(distServerDir)) {
  resetDir(distCompatServerDir);
  cpSync(distServerDir, distCompatServerDir, { recursive: true });
}

if (existsSync(providerPluginsDir)) {
  for (const entry of readdirSync(providerPluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pluginRoot = join(providerPluginsDir, entry.name);
    const distPluginRoot = join(distProviderPluginsDir, entry.name);

    for (const pluginEntry of readdirSync(pluginRoot, { withFileTypes: true })) {
      if (!pluginEntry.isDirectory() || pluginEntry.name === "src") continue;
      copyDirIfPresent(join(pluginRoot, pluginEntry.name), join(distPluginRoot, pluginEntry.name));
    }
  }
}
