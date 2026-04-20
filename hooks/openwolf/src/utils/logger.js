import * as fs from "node:fs";
import * as path from "node:path";
const LEVEL_ORDER = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};
export class Logger {
    logFile;
    level;
    constructor(logFile, level = "info") {
        this.logFile = logFile;
        this.level = level;
        if (logFile) {
            const dir = path.dirname(logFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }
    }
    shouldLog(level) {
        return LEVEL_ORDER[level] >= LEVEL_ORDER[this.level];
    }
    format(level, message) {
        const ts = new Date().toISOString();
        return `[${ts}] [${level.toUpperCase()}] ${message}`;
    }
    write(level, message) {
        if (!this.shouldLog(level))
            return;
        const line = this.format(level, message);
        if (level === "error") {
            console.error(line);
        }
        else {
            console.log(line);
        }
        if (this.logFile) {
            fs.appendFileSync(this.logFile, line + "\n", "utf-8");
        }
    }
    debug(msg) { this.write("debug", msg); }
    info(msg) { this.write("info", msg); }
    warn(msg) { this.write("warn", msg); }
    error(msg) { this.write("error", msg); }
}
