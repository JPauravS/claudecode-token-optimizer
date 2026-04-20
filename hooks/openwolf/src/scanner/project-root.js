import * as path from "node:path";
import * as fs from "node:fs";
const MARKERS = [
    ".git",
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "setup.py",
    "Makefile",
    "CMakeLists.txt",
    "build.gradle",
    "pom.xml",
    "composer.json",
    "Gemfile",
    ".project",
    "deno.json",
];
export function findProjectRoot(from) {
    let dir = path.resolve(from ?? process.cwd());
    const root = path.parse(dir).root;
    let depth = 0;
    while (depth < 10) {
        for (const marker of MARKERS) {
            if (fs.existsSync(path.join(dir, marker))) {
                return dir;
            }
        }
        // Fallback: .wolf/ directory
        if (fs.existsSync(path.join(dir, ".wolf"))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir || parent === root)
            break;
        dir = parent;
        depth++;
    }
    // Default to cwd
    return path.resolve(from ?? process.cwd());
}
