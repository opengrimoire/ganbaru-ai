#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEV_CONFIG = path.join("src-tauri", "tauri.dev.conf.json");

/**
 * Finds the boundary between Tauri CLI options and application arguments.
 *
 * @param {string[]} args CLI arguments.
 * @returns {number} Index where application arguments begin.
 */
function appArgsStart(args) {
  const markerIndex = args.indexOf("--");
  return markerIndex === -1 ? args.length : markerIndex;
}

/**
 * Checks whether the command already provides a Tauri config override.
 *
 * @param {string[]} args CLI arguments.
 * @returns {boolean} Whether a config override is present.
 */
function hasConfigOverride(args) {
  const end = appArgsStart(args);
  for (let i = 1; i < end; i += 1) {
    const arg = args[i];
    if (arg === "--config" || arg === "-c" || arg.startsWith("--config=")) {
      return true;
    }
  }
  return false;
}

/**
 * Adds GanbaruAI's dev identity to desktop dev runs by default.
 *
 * @param {string[]} args CLI arguments.
 * @returns {string[]} Arguments to pass to the Tauri CLI.
 */
function withDevConfig(args) {
  if (args[0] !== "dev" || hasConfigOverride(args)) {
    return args;
  }

  const insertAt = appArgsStart(args);
  return [
    ...args.slice(0, insertAt),
    "--config",
    DEV_CONFIG,
    ...args.slice(insertAt),
  ];
}

const command = process.platform === "win32" ? "tauri.cmd" : "tauri";
const child = spawn(command, withDevConfig(process.argv.slice(2)), {
  cwd: CLIENT_ROOT,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`Failed to run Tauri CLI: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
