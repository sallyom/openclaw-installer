import { readdir, readFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import type { DeployerRegistry, InstallerPlugin } from "../deployers/registry.js";

const PLUGIN_PREFIX = "openclaw-installer-";
const CONFIG_PATH = join(homedir(), ".openclaw", "installer", "plugins.json");
const BUILT_RUNTIME_SEGMENT = `${sep}dist${sep}`;

function isBuiltRuntime(): boolean {
  return import.meta.dirname.includes(BUILT_RUNTIME_SEGMENT);
}

async function discoverProviderPlugins(registry: DeployerRegistry): Promise<void> {
  // Resolve repo root: this file is at src/server/plugins/loader.ts, so 3 levels up
  const repoRoot = join(import.meta.dirname, "..", "..", "..");
  const builtRuntime = isBuiltRuntime();
  const providerPluginsDir = builtRuntime
    ? join(repoRoot, "dist", "provider-plugins")
    : join(repoRoot, "provider-plugins");

  if (!existsSync(providerPluginsDir)) return;

  let entries;
  try {
    entries = await readdir(providerPluginsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const name = String(entry.name);
    const jsIndex = join(providerPluginsDir, name, "src", "index.js");
    const srcIndex = join(providerPluginsDir, name, "src", "index.ts");

    const entryPoint = builtRuntime
      ? (existsSync(jsIndex) ? jsIndex : null)
      : (existsSync(srcIndex) ? srcIndex : existsSync(jsIndex) ? jsIndex : null);
    if (!entryPoint) continue;

    try {
      const mod = await import(pathToFileURL(entryPoint).href);
      const plugin: InstallerPlugin | undefined = mod.default ?? mod;

      if (typeof plugin?.register !== "function") {
        console.warn(`Provider plugin "${name}" does not export a register function, skipping`);
        continue;
      }

      plugin.register(registry);
      console.log(`Loaded provider plugin: ${name}`);
    } catch (err) {
      console.warn(`Failed to load provider plugin "${name}":`, err);
    }
  }
}

async function discoverNpmPlugins(): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const plugins: string[] = [];

  try {
    const expressPath = require.resolve("express");
    const nodeModulesDir = join(expressPath.split("node_modules")[0], "node_modules");
    const entries = await readdir(nodeModulesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      if (entry.name.startsWith(PLUGIN_PREFIX)) {
        plugins.push(entry.name);
        continue;
      }

      // Check scoped packages (@scope/openclaw-installer-*)
      if (entry.name.startsWith("@")) {
        try {
          const scopedEntries = await readdir(join(nodeModulesDir, entry.name), { withFileTypes: true });
          for (const scoped of scopedEntries) {
            if ((scoped.isDirectory() || scoped.isSymbolicLink()) && scoped.name.startsWith(PLUGIN_PREFIX)) {
              plugins.push(`${entry.name}/${scoped.name}`);
            }
          }
        } catch {
          // skip unreadable scope dirs
        }
      }
    }
  } catch {
    // node_modules not found or unreadable
  }
  return plugins;
}

async function loadConfigPlugins(): Promise<string[]> {
  if (!existsSync(CONFIG_PATH)) return [];

  try {
    const content = await readFile(CONFIG_PATH, "utf8");
    const config = JSON.parse(content);
    if (Array.isArray(config.plugins)) {
      return config.plugins.filter((p: unknown) => typeof p === "string");
    }
  } catch (err) {
    console.warn(`Failed to read plugin config at ${CONFIG_PATH}:`, err);
  }

  return [];
}

async function loadPlugin(registry: DeployerRegistry, moduleId: string): Promise<void> {
  console.log(`Attempting to load plugin: ${moduleId}`);
  try {
    const mod = await import(moduleId);
    const plugin: InstallerPlugin | undefined = mod.default ?? mod;

    if (typeof plugin?.register !== "function") {
      console.warn(`Plugin "${moduleId}" does not export a register function, skipping`);
      return;
    }

    plugin.register(registry);
    console.log(`Loaded plugin: ${moduleId}`);
  } catch (err) {
    console.warn(`Failed to load plugin "${moduleId}":`, err);
  }
}

export async function loadPlugins(registry: DeployerRegistry): Promise<void> {
  // Load provider plugins from provider-plugins/ before npm plugins
  await discoverProviderPlugins(registry);

  const npmPlugins = await discoverNpmPlugins();
  const configPlugins = await loadConfigPlugins();

  const allPlugins = [...new Set([...npmPlugins, ...configPlugins])];

  if (allPlugins.length === 0) return;

  for (const pluginId of allPlugins) {
    await loadPlugin(registry, pluginId);
  }
}
