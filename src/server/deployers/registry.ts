import type { Deployer } from "./types.js";

export interface DeployerRegistration {
  mode: string;
  title: string;
  description: string;
  deployer: Deployer;
  detect?: () => Promise<boolean>;
  priority?: number;
}

export interface InstallerPlugin {
  register(registry: DeployerRegistry): void;
}

export class DeployerRegistry {
  private registrations = new Map<string, DeployerRegistration>();

  register(reg: DeployerRegistration): void {
    if (this.registrations.has(reg.mode)) {
      console.warn(`DeployerRegistry: overwriting existing registration for mode "${reg.mode}"`);
    }
    this.registrations.set(reg.mode, reg);
  }

  get(mode: string): Deployer | null {
    return this.registrations.get(mode)?.deployer ?? null;
  }

  list(): DeployerRegistration[] {
    return Array.from(this.registrations.values());
  }

  async detect(): Promise<DeployerRegistration[]> {
    const results: DeployerRegistration[] = [];
    for (const reg of this.registrations.values()) {
      if (!reg.detect) {
        results.push(reg);
        continue;
      }
      try {
        if (await reg.detect()) {
          results.push(reg);
        }
      } catch {
        // detect failed — treat as unavailable
      }
    }
    return results;
  }
}

export const registry = new DeployerRegistry();
