import * as path from "node:path";
import { readJSON } from "../utils/fs-safe.js";
export function getHealth(wolfDir, startTime) {
    const cronState = readJSON(path.join(wolfDir, "cron-state.json"), {
        last_heartbeat: null,
        dead_letter_queue: [],
    });
    const manifest = readJSON(path.join(wolfDir, "cron-manifest.json"), { tasks: [] });
    const deadLetterCount = cronState.dead_letter_queue.length;
    let status = "healthy";
    if (deadLetterCount > 0)
        status = "degraded";
    if (deadLetterCount > 3)
        status = "unhealthy";
    return {
        status,
        uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
        last_heartbeat: cronState.last_heartbeat,
        tasks: manifest.tasks.length,
        dead_letters: deadLetterCount,
    };
}
