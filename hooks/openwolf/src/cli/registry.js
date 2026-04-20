/**
 * Central registry of all OpenWolf-managed projects.
 * Stored at ~/.openwolf/registry.json
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
export function getRegistryDir() {
    return path.join(os.homedir(), ".openwolf");
}
export function getRegistryPath() {
    return path.join(getRegistryDir(), "registry.json");
}
export function readRegistry() {
    const registryPath = getRegistryPath();
    try {
        const raw = fs.readFileSync(registryPath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return { version: 1, projects: [] };
    }
}
export function writeRegistry(registry) {
    const dir = getRegistryDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2), "utf-8");
}
/**
 * Register a project in the central registry.
 * Updates existing entry if the project root matches.
 */
export function registerProject(projectRoot, name, version) {
    const registry = readRegistry();
    const normalized = normalizePath(projectRoot);
    const now = new Date().toISOString();
    const existing = registry.projects.find(p => normalizePath(p.root) === normalized);
    if (existing) {
        existing.name = name;
        existing.last_updated = now;
        existing.version = version;
    }
    else {
        registry.projects.push({
            root: projectRoot,
            name,
            registered_at: now,
            last_updated: now,
            version,
        });
    }
    writeRegistry(registry);
}
/**
 * Remove a project from the registry (e.g., if the directory no longer exists).
 */
export function unregisterProject(projectRoot) {
    const registry = readRegistry();
    const normalized = normalizePath(projectRoot);
    registry.projects = registry.projects.filter(p => normalizePath(p.root) !== normalized);
    writeRegistry(registry);
}
/**
 * Get all registered projects, optionally filtering out ones that no longer exist.
 */
export function getRegisteredProjects(validateExists = false) {
    const registry = readRegistry();
    if (!validateExists)
        return registry.projects;
    const valid = [];
    const removed = [];
    for (const project of registry.projects) {
        const wolfDir = path.join(project.root, ".wolf");
        if (fs.existsSync(wolfDir)) {
            valid.push(project);
        }
        else {
            removed.push(project.root);
        }
    }
    // Clean up stale entries
    if (removed.length > 0) {
        registry.projects = valid;
        writeRegistry(registry);
    }
    return valid;
}
function normalizePath(p) {
    return p.replace(/\\/g, "/").toLowerCase();
}
