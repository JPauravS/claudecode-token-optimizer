import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
export function readJSON(filePath, fallback) {
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
export function writeJSON(filePath, data) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
        fs.renameSync(tmp, filePath);
    }
    catch {
        // On Windows, rename can fail if another process holds a handle.
        // Fall back to direct write and clean up the tmp file.
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
        }
        catch { }
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
    }
}
export function readText(filePath, fallback = "") {
    try {
        return fs.readFileSync(filePath, "utf-8");
    }
    catch {
        return fallback;
    }
}
export function writeText(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = filePath + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    try {
        fs.writeFileSync(tmp, content, "utf-8");
        fs.renameSync(tmp, filePath);
    }
    catch {
        // On Windows, rename can fail if another process holds a handle.
        // Fall back to direct write and clean up the tmp file.
        try {
            fs.writeFileSync(filePath, content, "utf-8");
        }
        catch { }
        try {
            fs.unlinkSync(tmp);
        }
        catch { }
    }
}
export function appendText(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(filePath, content, "utf-8");
}
