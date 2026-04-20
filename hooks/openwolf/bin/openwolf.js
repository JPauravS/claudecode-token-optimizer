#!/usr/bin/env node
const major = parseInt(process.versions.node.split(".")[0], 10);
if (major < 20) {
    console.error(`OpenWolf requires Node.js 20 or higher. You are running ${process.version}.`);
    process.exit(1);
}
import { createProgram } from "../src/cli/index.js";
const program = createProgram();
program.parse(process.argv);
