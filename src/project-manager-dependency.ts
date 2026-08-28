import type { App } from "obsidian";

export const PROJECT_MANAGER_ID = "project-manager";
export const PROJECT_MANAGER_LISTING_URI = "obsidian://show-plugin?id=project-manager";

interface PluginRegistry {
  manifests?: Record<string, unknown>;
  getPlugin?(id: string): unknown;
}

export type ProjectManagerDependencyState = "ready" | "disabled" | "missing" | "unknown";

export function projectManagerDependencyState(app: App): ProjectManagerDependencyState {
  const registry = (app as App & { plugins?: PluginRegistry }).plugins;
  if (!registry) return "unknown";
  if (registry.getPlugin?.(PROJECT_MANAGER_ID)) return "ready";
  if (!registry.manifests) return "unknown";
  return Object.prototype.hasOwnProperty.call(registry.manifests, PROJECT_MANAGER_ID)
    ? "disabled"
    : "missing";
}

export function openProjectManagerCommunityPage(): void {
  window.open(PROJECT_MANAGER_LISTING_URI);
}
