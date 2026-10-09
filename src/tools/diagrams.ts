import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SpecSchema, UpdateSchema, applyUpdate, validate } from "../core/model.js";
import * as store from "../core/store.js";
import { understand } from "../core/understand.js";
import { OUTPUT_DIR, outDir, result, traced } from "./shared.js";

/** create / update / get / delete / list: the low-level tools for when the caller already has a spec. */
export function registerDiagramTools(server: McpServer): void {
  server.registerTool(
    "create_diagram",
    {
      description:
        "Create an icon-based architecture or flow diagram and return it as a PNG. " +
        "Every service or actor should be a node with an icon ('aws:bedrock', 'gcp:gke', 'azure:functions'); the server also infers icons from labels. " +
        "Keep it simple: labels 1-3 words (extra text in `detail`), ~12 nodes max, collapse internal steps. " +
        "Icon-less nodes become flowchart shapes (box/pill/diamond). Use `groups` for VPC/region/Lambda boundaries. " +
        "Layout is automatic. Returns diagram_id for update_diagram, plus notes about problems to fix.",
      inputSchema: {
        ...SpecSchema.shape,
        name: z
          .string()
          .optional()
          .describe(
            "Stable name for this diagram (becomes the file name and diagram_id). Defaults to the title. Creating with a name that already exists REPLACES that diagram, so re-use the same name rather than making copies.",
          ),
        output_dir: OUTPUT_DIR,
      },
    },
    traced("create_diagram", async ({ output_dir, name, ...args }, t) => {
      const parsed = SpecSchema.parse(args);
      const where = await outDir(server, t, output_dir);
      const { spec, notes } = understand(parsed);
      t.set("auto_enriched_spec", spec);
      validate(spec);
      const id = store.idFor(name ?? spec.title ?? "diagram");
      const replaced = store.exists(where.dir, id);
      const prefix = id.split("-").slice(0, 2).join("-");
      const similar = store
        .list(where.dir)
        .filter((d) => d.id !== id && d.id.startsWith(prefix))
        .map((d) => d.id);
      if (similar.length) {
        notes.push(
          `Similar diagrams already exist here: ${similar.join(", ")}. If this replaces one, delete_diagram it; to change a diagram use update_diagram (or create_diagram with the same name).`,
        );
      }
      return result(t, where, id, spec, replaced ? "Replaced" : "Created", notes);
    }),
  );

  server.registerTool(
    "update_diagram",
    {
      description:
        "Modify an existing diagram by diagram_id: add/update/remove nodes, edges and groups, change title or direction. Returns the re-rendered PNG.",
      inputSchema: { diagram_id: z.string(), ...UpdateSchema.shape, output_dir: OUTPUT_DIR },
    },
    traced("update_diagram", async ({ diagram_id, output_dir, ...ops }, t) => {
      const where = store.locate(await outDir(server, t, output_dir), diagram_id);
      t.dir = where.dir;
      const { spec, notes } = understand(applyUpdate(store.load(where.dir, diagram_id), UpdateSchema.parse(ops)));
      validate(spec);
      return result(t, where, diagram_id, spec, "Updated", notes);
    }),
  );

  server.registerTool(
    "get_diagram",
    {
      description: "Return the current spec (JSON) and PNG of a diagram, e.g. to inspect before updating.",
      inputSchema: { diagram_id: z.string(), output_dir: OUTPUT_DIR },
    },
    traced("get_diagram", async ({ diagram_id, output_dir }, t) => {
      const where = store.locate(await outDir(server, t, output_dir), diagram_id);
      t.dir = where.dir;
      const spec = store.load(where.dir, diagram_id);
      const r = result(t, where, diagram_id, spec, "Loaded");
      r.content.push({ type: "text", text: JSON.stringify(spec) });
      return r;
    }),
  );

  server.registerTool(
    "delete_diagram",
    {
      description: "Delete a diagram (PNG and spec) by diagram_id.",
      inputSchema: { diagram_id: z.string(), output_dir: OUTPUT_DIR },
    },
    traced("delete_diagram", async ({ diagram_id, output_dir }, t) => {
      const where = store.locate(await outDir(server, t, output_dir), diagram_id);
      t.dir = where.dir;
      return { content: [{ type: "text", text: "Deleted:\n" + store.remove(where.dir, diagram_id).join("\n") }] };
    }),
  );

  server.registerTool(
    "list_diagrams",
    { description: "List previously created diagrams (newest first).", inputSchema: { output_dir: OUTPUT_DIR } },
    traced("list_diagrams", async ({ output_dir }, t) => ({
      content: [{ type: "text", text: JSON.stringify(store.list((await outDir(server, t, output_dir)).dir), null, 1) }],
    })),
  );
}
