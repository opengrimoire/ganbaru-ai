#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = path.resolve(CLIENT_ROOT, "../..");
const SERVER_START_TIMEOUT_MS = 20_000;
const DIAGNOSTIC_IDLE_MS = 2_000;
const EMPTY_DIAGNOSTIC_MIN_WAIT_MS = 7_000;
const DIAGNOSTIC_TIMEOUT_MS = 45_000;
const CANONICAL_CLASS_CODE = "suggestCanonicalClasses";

const LANGUAGE_BY_EXTENSION = new Map([
  [".css", "css"],
  [".html", "html"],
  [".js", "javascript"],
  [".mjs", "javascript"],
  [".svelte", "svelte"],
  [".ts", "typescript"],
]);

const TAILWIND_SETTINGS = {
  validate: true,
  classAttributes: ["class", "className", "ngClass", "class:list"],
  includeLanguages: {
    svelte: "html",
  },
  lint: {
    cssConflict: "warning",
    invalidApply: "error",
    invalidConfigPath: "error",
    invalidScreen: "error",
    invalidTailwindDirective: "error",
    invalidVariant: "error",
    recommendedVariantOrder: "warning",
    suggestCanonicalClasses: "warning",
    usedBlocklistedClass: "warning",
  },
  experimental: {
    configFile: path.join(CLIENT_ROOT, "src/app.css"),
  },
};

/**
 * Recursively lists files that Tailwind's language server can inspect.
 *
 * @param {string} directory Directory to scan.
 * @returns {Promise<string[]>} Supported source file paths.
 */
async function listSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(fullPath));
      continue;
    }

    const extension = path.extname(entry.name);
    if (LANGUAGE_BY_EXTENSION.has(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Converts a local file path to a language server document item.
 *
 * @param {string} filePath Source file path.
 * @returns {Promise<{ languageId: string, text: string, uri: string }>} LSP document item.
 */
async function readDocument(filePath) {
  const extension = path.extname(filePath);
  const languageId = LANGUAGE_BY_EXTENSION.get(extension);
  if (!languageId) {
    throw new Error(`Unsupported file extension: ${filePath}`);
  }

  return {
    languageId,
    text: await readFile(filePath, "utf8"),
    uri: pathToFileURL(filePath).href,
  };
}

/**
 * Maps a file URI back to a repository-relative path.
 *
 * @param {string} uri File URI.
 * @returns {string} Repository-relative path.
 */
function relativePathFromUri(uri) {
  return path.relative(WORKSPACE_ROOT, fileURLToPath(uri));
}

/**
 * Creates a minimal Language Server Protocol client for request/notification exchange.
 *
 * @param {import("node:child_process").ChildProcessWithoutNullStreams} child Language server process.
 * @returns {{
 *   diagnostics: Map<string, unknown[]>,
 *   request(method: string, params?: unknown): Promise<unknown>,
 *   sendNotification(method: string, params?: unknown): void,
 * }}
 */
function createLspClient(child) {
  let nextId = 1;
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  const diagnostics = new Map();

  /**
   * Sends a JSON-RPC payload with LSP framing.
   *
   * @param {unknown} payload JSON-RPC payload.
   */
  function send(payload) {
    const json = JSON.stringify(payload);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  }

  /**
   * Resolves a server request with a JSON-RPC response.
   *
   * @param {number | string} id Request id.
   * @param {unknown} result Result payload.
   */
  function respond(id, result) {
    send({ jsonrpc: "2.0", id, result });
  }

  /**
   * Handles requests sent from the language server to this client.
   *
   * @param {{ id?: number | string, method?: string, params?: unknown }} message LSP message.
   */
  function handleServerRequest(message) {
    if (message.id === undefined || !message.method) {
      return;
    }

    if (message.method === "workspace/configuration") {
      const params = /** @type {{ items?: Array<{ section?: string }> }} */ (message.params ?? {});
      respond(message.id, (params.items ?? []).map((item) => {
        if (item.section === "tailwindCSS") {
          return TAILWIND_SETTINGS;
        }
        return null;
      }));
      return;
    }

    if (message.method === "workspace/workspaceFolders") {
      respond(message.id, [{
        name: "GanbaruAI",
        uri: pathToFileURL(WORKSPACE_ROOT).href,
      }]);
      return;
    }

    if (message.method === "client/registerCapability" || message.method === "window/workDoneProgress/create") {
      respond(message.id, null);
      return;
    }

    respond(message.id, null);
  }

  /**
   * Handles one decoded LSP message.
   *
   * @param {{ id?: number | string, method?: string, params?: unknown, result?: unknown, error?: unknown }} message LSP message.
   */
  function handleMessage(message) {
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
        return;
      }
      resolve(message.result);
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      const params = /** @type {{ uri?: string, diagnostics?: unknown[] }} */ (message.params ?? {});
      if (params.uri) {
        diagnostics.set(params.uri, params.diagnostics ?? []);
      }
      return;
    }

    handleServerRequest(message);
  }

  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        break;
      }

      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) {
        throw new Error(`Invalid LSP header: ${header}`);
      }

      const contentLength = Number(match[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (buffer.length < messageEnd) {
        break;
      }

      const message = JSON.parse(buffer.subarray(messageStart, messageEnd).toString("utf8"));
      buffer = buffer.subarray(messageEnd);
      handleMessage(message);
    }
  });

  return {
    diagnostics,
    request(method, params) {
      const id = nextId++;
      send({ jsonrpc: "2.0", id, method, params });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    sendNotification(method, params) {
      send({ jsonrpc: "2.0", method, params });
    },
  };
}

/**
 * Waits for diagnostics after opening documents.
 *
 * @param {Map<string, unknown[]>} diagnostics Published diagnostics by URI.
 * @param {number} expectedDocumentCount Number of documents opened.
 * @returns {Promise<void>}
 */
async function waitForDiagnostics(diagnostics, expectedDocumentCount) {
  const start = Date.now();
  let lastCount = diagnostics.size;
  let lastChange = Date.now();

  while (Date.now() - start < DIAGNOSTIC_TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (diagnostics.size !== lastCount) {
      lastCount = diagnostics.size;
      lastChange = Date.now();
    }

    if (diagnostics.size >= expectedDocumentCount && Date.now() - lastChange >= DIAGNOSTIC_IDLE_MS) {
      return;
    }

    if (diagnostics.size > 0 && Date.now() - lastChange >= DIAGNOSTIC_IDLE_MS) {
      return;
    }

    if (diagnostics.size === 0 && Date.now() - start >= EMPTY_DIAGNOSTIC_MIN_WAIT_MS) {
      return;
    }
  }
}

/**
 * Formats selected diagnostics for terminal output.
 *
 * @param {Map<string, unknown[]>} diagnostics Published diagnostics by URI.
 * @returns {string[]} Human-readable diagnostic lines.
 */
function formatCanonicalClassDiagnostics(diagnostics) {
  const findings = [];

  for (const [uri, entries] of diagnostics) {
    for (const diagnostic of entries) {
      const item = /** @type {{ code?: string | number, message?: string, range?: { start?: { line?: number, character?: number } } }} */ (diagnostic);
      if (String(item.code) !== CANONICAL_CLASS_CODE) {
        continue;
      }

      const line = (item.range?.start?.line ?? 0) + 1;
      const column = (item.range?.start?.character ?? 0) + 1;
      findings.push({
        column,
        line,
        message: item.message ?? "",
        path: relativePathFromUri(uri),
      });
    }
  }

  return findings
    .sort((left, right) => (
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column
    ))
    .map((finding) => (
      `${finding.path}:${finding.line}:${finding.column} ${CANONICAL_CLASS_CODE} ${finding.message}`.trim()
    ));
}

/**
 * Runs Tailwind language server diagnostics for canonical class suggestions.
 */
async function main() {
  const require = createRequire(import.meta.url);
  const serverBin = require.resolve("@tailwindcss/language-server/bin/tailwindcss-language-server");
  const files = [
    path.join(CLIENT_ROOT, "src/app.css"),
    path.join(CLIENT_ROOT, "index.html"),
    ...await listSourceFiles(path.join(CLIENT_ROOT, "src")),
  ];
  const uniqueFiles = [...new Set(files)];

  const child = spawn(process.execPath, [serverBin, "--stdio"], {
    cwd: CLIENT_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  const client = createLspClient(child);
  const startTimeout = setTimeout(() => {
    child.kill();
  }, SERVER_START_TIMEOUT_MS);

  try {
    await client.request("initialize", {
      processId: process.pid,
      rootPath: CLIENT_ROOT,
      rootUri: pathToFileURL(CLIENT_ROOT).href,
      workspaceFolders: [{
        name: "@ganbaruai/client",
        uri: pathToFileURL(CLIENT_ROOT).href,
      }],
      capabilities: {
        textDocument: {
          publishDiagnostics: {
            relatedInformation: true,
            codeDescriptionSupport: true,
            dataSupport: true,
          },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
        },
      },
      initializationOptions: {
        settings: {
          tailwindCSS: TAILWIND_SETTINGS,
        },
      },
    });
    clearTimeout(startTimeout);

    client.sendNotification("initialized", {});
    client.sendNotification("workspace/didChangeConfiguration", {
      settings: {
        tailwindCSS: TAILWIND_SETTINGS,
      },
    });

    for (const filePath of uniqueFiles) {
      const document = await readDocument(filePath);
      client.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri: document.uri,
          languageId: document.languageId,
          version: 1,
          text: document.text,
        },
      });
    }

    await waitForDiagnostics(client.diagnostics, uniqueFiles.length);
    const findings = formatCanonicalClassDiagnostics(client.diagnostics);

    await client.request("shutdown");
    client.sendNotification("exit");

    if (findings.length > 0) {
      console.error(`Tailwind canonical class diagnostics found ${findings.length} issue(s):`);
      for (const finding of findings) {
        console.error(finding);
      }
      process.exitCode = 1;
      return;
    }

    console.log("Tailwind canonical class diagnostics passed.");
  } catch (error) {
    clearTimeout(startTimeout);
    child.kill();
    console.error(error instanceof Error ? error.message : String(error));
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    process.exitCode = 1;
  }
}

await main();
