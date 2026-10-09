import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const KEEP = 200;
const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{4}$/;

export const homeDir = () => path.join(os.homedir(), ".diagram-mcp");

/** One record per MCP tool call: what came in, where it was written, what happened. Written to <dir>/logs/<log_id>.json */
export class Trace {
  readonly log_id: string;
  readonly started = new Date();
  readonly data: Record<string, unknown> = {};
  /** Base .diagram-mcp dir once known; until then logs go to the home fallback. */
  dir?: string;

  constructor(
    readonly tool: string,
    readonly input: unknown,
  ) {
    const t = this.started.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    this.log_id = `${t}-${randomBytes(2).toString("hex")}`;
  }

  set(key: string, value: unknown): void {
    this.data[key] = value;
  }

  write(status: "ok" | "error", error?: unknown): string | undefined {
    const dir = path.join(this.dir ?? homeDir(), "logs");
    const record = {
      log_id: this.log_id,
      tool: this.tool,
      status,
      started: this.started.toISOString(),
      duration_ms: Date.now() - this.started.getTime(),
      input: this.input,
      ...this.data,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error === undefined
            ? undefined
            : { message: String(error) },
      server: { version: this.data.server_version, node: process.version, pid: process.pid, cwd: process.cwd() },
    };
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${this.log_id}.json`);
      fs.writeFileSync(file, JSON.stringify(record, null, 2));
      prune(dir);
      return file;
    } catch {
      return undefined; // logging must never break the tool call
    }
  }
}

function prune(dir: string): void {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(dir, f), { force: true });
}

/** Read a log by id, or the newest one when id is omitted / "latest". Searches the given dirs in order. */
export function readLog(dirs: string[], id?: string): { file: string; text: string } {
  for (const base of dirs) {
    const dir = path.join(base, "logs");
    if (!fs.existsSync(dir)) continue;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const pick =
      !id || id === "latest" ? files.at(-1) : ID_RE.test(id) ? files.find((f) => f === `${id}.json`) : undefined;
    if (pick) return { file: path.join(dir, pick), text: fs.readFileSync(path.join(dir, pick), "utf8") };
  }
  throw new Error(
    id && id !== "latest"
      ? `No log '${id}' found (looked in ${dirs.join(", ")}).`
      : `No logs found in ${dirs.join(", ")}.`,
  );
}
