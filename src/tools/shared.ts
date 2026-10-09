import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Trace } from "../core/logs.js";
import type { SpecSchema } from "../core/model.js";
import * as store from "../core/store.js";
import { renderPng } from "../render/index.js";

export const VERSION = "0.4.0";

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export type ToolResult = { content: Content[]; isError?: boolean };
export type Where = { dir: string; source: store.DirSource };

export const OUTPUT_DIR = z
  .string()
  .optional()
  .describe(
    "Absolute path of the project folder the user is working in (the workspace root). The PNG is written to <output_dir>/.diagram-mcp/. ALWAYS pass this.",
  );

export const fail = (e: unknown): ToolResult => ({
  isError: true,
  content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }],
});

/**
 * Where to write: output_dir argument > MCP roots > server cwd > home.
 * Some clients (Kiro) report no roots and a useless cwd, hence the explicit output_dir argument.
 */
export async function outDir(server: McpServer, t: Trace, outputDir?: string): Promise<Where> {
  let root: string | undefined;
  const caps = server.server.getClientCapabilities();
  const rootsInfo: Record<string, unknown> = { advertised: !!caps?.roots };
  if (!outputDir && caps?.roots) {
    try {
      const { roots } = await server.server.listRoots();
      rootsInfo.roots = roots.map((r) => r.uri);
      root = roots.map((r) => store.rootToPath(r.uri)).find(Boolean);
    } catch (e) {
      rootsInfo.error = String(e); // client advertised roots but failed to list them: fall through to cwd
    }
  }
  const where = store.resolveDir({ outputDir, root, cwd: process.cwd() });
  t.dir = where.dir;
  t.set("workspace", {
    output_dir_arg: outputDir ?? null,
    resolved_dir: where.dir,
    source: where.source,
    mcp_roots: rootsInfo,
    client: server.server.getClientVersion(),
  });
  return where;
}

/** Render, save, and build the reply (image + summary text). */
export function result(
  t: Trace,
  where: Where,
  id: string,
  spec: z.infer<typeof SpecSchema>,
  verb: string,
  notes: string[] = [],
): ToolResult {
  const png = renderPng(spec);
  const file = store.save(where.dir, id, spec, png);
  t.set("diagram", {
    diagram_id: id,
    png: file,
    png_bytes: png.length,
    nodes: spec.nodes.length,
    edges: spec.edges.length,
    groups: spec.groups.length,
  });
  t.set("notes", notes);
  t.set("final_spec", spec);
  if (where.source === "home-fallback") {
    notes = [
      ...notes,
      "Saved to the home fallback because the workspace is unknown. Pass output_dir (absolute project path) so it lands in <project>/.diagram-mcp/.",
    ];
  }
  const counts = `${spec.nodes.length} nodes, ${spec.edges.length} edges, ${spec.groups.length} groups`;
  return {
    content: [
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      {
        type: "text",
        text:
          `${verb} diagram_id=${id} (${counts}). PNG saved at ${file}. ` +
          "To change it call update_diagram with this diagram_id (or create_diagram with the same name to replace it); do not create a second copy." +
          (notes.length ? "\nNotes:\n- " + notes.join("\n- ") : ""),
      },
    ],
  };
}

/** Wrap a handler: one log per call, with its log_id appended to the reply so the model (or user) can quote it. */
// Args are validated by each tool's zod inputSchema before the handler runs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function traced(tool: string, fn: (args: any, t: Trace, extra: any) => Promise<ToolResult>) {
  return async (args: unknown, extra: unknown): Promise<ToolResult> => {
    const t = new Trace(tool, args);
    t.set("server_version", VERSION);
    let res: ToolResult;
    let err: unknown;
    try {
      res = await fn(args, t, extra);
    } catch (e) {
      err = e;
      res = fail(e);
    }
    const text = res.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    t.set("reply_text", text.length > 4000 ? text.slice(0, 4000) + "…" : text);
    const file = t.write(err || res.isError ? "error" : "ok", err ?? (res.isError ? text : undefined));
    res.content.push({
      type: "text",
      text: `log_id=${t.log_id}${file ? ` (log: ${file})` : ""}. If this looks wrong, call get_log with this log_id.`,
    });
    return res;
  };
}

/** MCP progress notification, so clients that reset their tool timeout on progress keep waiting. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function progressFn(extra: any) {
  const token = extra?._meta?.progressToken;
  return (n: number, total: number, message: string) => {
    if (token === undefined) return;
    void extra
      .sendNotification({
        method: "notifications/progress",
        params: { progressToken: token, progress: n, total, message },
      })
      .catch(() => {});
  };
}
