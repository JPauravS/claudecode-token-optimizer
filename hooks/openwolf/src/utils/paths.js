import * as path from "node:path";
import * as fs from "node:fs";
export function normalizePath(p) {
    return p.replace(/\\/g, "/");
}
export function getWolfDir(from) {
    const base = from ?? process.cwd();
    return path.join(base, ".wolf");
}
export function resolveWolfFile(file, from) {
    return path.join(getWolfDir(from), file);
}
export function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
export function relativeToCwd(filePath, cwd) {
    const base = cwd ?? process.cwd();
    const rel = path.relative(base, filePath);
    return normalizePath(rel);
}
