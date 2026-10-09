import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Spec } from "./model.js";

/**
 * Output dir: $DIAGRAM_MCP_DIR, else <caller workspace>/.diagram-mcp, else ~/.diagram-mcp.
 * The caller workspace is passed in by index.ts (MCP roots, falling back to process cwd).
 */
export type DirSource = "env" | "output_dir" | "mcp-roots" | "cwd" | "home-fallback";

export function resolveDir(c: { outputDir?: string; root?: string; cwd?: string }): { dir: string; source: DirSource } {
  if (process.env.DIAGRAM_MCP_DIR) return { dir: path.resolve(process.env.DIAGRAM_MCP_DIR), source: "env" };
  const usable = (p?: string) => !!p && p !== path.parse(p).root && path.resolve(p) !== os.homedir();
  if (c.outputDir) {
    const p = c.outputDir.replace(/^~(?=$|\/)/, os.homedir());
    if (!path.isAbsolute(p)) throw new Error(`output_dir must be an absolute path, got '${c.outputDir}'`);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory())
      throw new Error(`output_dir '${p}' is not an existing directory`);
    return { dir: path.basename(p) === ".diagram-mcp" ? p : path.join(p, ".diagram-mcp"), source: "output_dir" };
  }
  if (usable(c.root)) return { dir: path.join(c.root!, ".diagram-mcp"), source: "mcp-roots" };
  if (usable(c.cwd)) return { dir: path.join(c.cwd!, ".diagram-mcp"), source: "cwd" };
  return { dir: path.join(os.homedir(), ".diagram-mcp"), source: "home-fallback" };
}

export const rootToPath = (uri: string): string | undefined => {
  try {
    return uri.startsWith("file:") ? fileURLToPath(uri) : undefined;
  } catch {
    return undefined;
  }
};

export const slug = (s?: string) =>
  (s ?? "diagram")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "") || "diagram";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;

/** A diagram's id is its file name, so creating with the same name overwrites instead of piling up copies. */
export const idFor = (name: string) => slug(name);

/** File base name for an id, if saved in dir. Also finds legacy `<slug>-d-xxxxxxxx` files by their d-xxxxxxxx id. */
function findBase(dir: string, id: string): string | undefined {
  if (!ID_RE.test(id) || !fs.existsSync(dir)) return undefined;
  if (fs.existsSync(path.join(dir, `${id}.json`))) return id;
  const f = fs.readdirSync(dir).find((n) => n.endsWith(`-${id}.json`));
  return f?.slice(0, -5);
}

export const exists = (dir: string, id: string) => !!findBase(dir, id);

export function remove(dir: string, id: string): string[] {
  const base = findBase(dir, id);
  if (!base) throw new Error(`Unknown diagram_id '${id}' in ${dir}. Use list_diagrams.`);
  const gone: string[] = [];
  for (const ext of [".json", ".png"]) {
    const f = path.join(dir, base + ext);
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      gone.push(f);
    }
  }
  return gone;
}

/** Diagram not in the resolved dir (e.g. created before output_dir was passed)? Look in the home fallback too. */
export function locate<T extends { dir: string; source: DirSource }>(where: T, id: string): T {
  if (findBase(where.dir, id)) return where;
  const home = path.join(os.homedir(), ".diagram-mcp");
  return findBase(home, id) ? { ...where, dir: home, source: "home-fallback" } : where;
}

export function save(dir: string, id: string, spec: Spec, png: Buffer): string {
  fs.mkdirSync(dir, { recursive: true });
  const base = findBase(dir, id) ?? id;
  fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify(spec, null, 2));
  const pngFile = path.join(dir, `${base}.png`);
  fs.writeFileSync(pngFile, png);
  return pngFile;
}

export function load(dir: string, id: string): Spec {
  const base = findBase(dir, id);
  if (!base) throw new Error(`Unknown diagram_id '${id}' in ${dir}. Use list_diagrams.`);
  return JSON.parse(fs.readFileSync(path.join(dir, `${base}.json`), "utf8"));
}

export function list(dir: string): { id: string; title?: string; nodes: number; png: string; modified: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const p = path.join(dir, f);
      const s = JSON.parse(fs.readFileSync(p, "utf8")) as Spec;
      return {
        id: f.slice(0, -5),
        title: s.title,
        nodes: s.nodes.length,
        png: p.replace(/\.json$/, ".png"),
        modified: fs.statSync(p).mtime.toISOString(),
      };
    })
    .sort((a, b) => b.modified.localeCompare(a.modified));
}
