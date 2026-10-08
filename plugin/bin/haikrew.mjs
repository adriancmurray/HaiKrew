#!/usr/bin/env node
// Launcher: runs the TypeScript CLI directly under Node's built-in type stripping. No build step.
const { main } = await import("../src/cli.ts");
process.exitCode = await main(process.argv.slice(2));
