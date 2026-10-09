import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as store from "../core/store.js";
import { MAX_ITERATIONS } from "../pipeline/critic.js";
import { LlmError, lmStudio } from "../pipeline/llm.js";
import { draw, summarize } from "../pipeline/pipeline.js";
import { OUTPUT_DIR, outDir, progressFn, result, traced } from "./shared.js";

/** draw_diagram: plain-language request -> interpreter -> review loop -> PNG. */
export function registerDrawTool(server: McpServer): void {
  server.registerTool(
    "draw_diagram",
    {
      description:
        "Describe the diagram in plain words and get a finished PNG. Pipeline: a request interpreter (local LLM) picks diagram type, direction, icons, nodes, edges and groups; " +
        `then a reviewer checks the result against your request and fixes it, at most ${MAX_ITERATIONS} passes. ` +
        "Slow (local model, can take minutes): use it when you want the server to do the design work. " +
        "To draw a spec you already have, use create_diagram. Pass diagram_id to change an existing diagram with a plain-language request.",
      inputSchema: {
        request: z
          .string()
          .describe(
            "What to draw, in plain language. Include the components, how they connect, and anything that must be shown (loops, returns, order).",
          ),
        name: z.string().optional().describe("Stable name / diagram_id for new diagrams. Same name replaces."),
        diagram_id: z.string().optional().describe("Existing diagram to modify according to `request`."),
        direction: z.enum(["LR", "TB"]).optional().describe("Force a direction. Omit to let the interpreter decide."),
        provider: z.enum(["aws", "gcp", "azure"]).optional().describe("Preferred cloud for icons."),
        max_iterations: z
          .number()
          .int()
          .min(1)
          .max(MAX_ITERATIONS)
          .optional()
          .describe(`Review passes, 1-${MAX_ITERATIONS} (default ${MAX_ITERATIONS}).`),
        output_dir: OUTPUT_DIR,
      },
    },
    traced(
      "draw_diagram",
      async ({ request, name, diagram_id, direction, provider, max_iterations, output_dir }, t, extra) => {
        const where = await outDir(server, t, output_dir);
        const located = diagram_id ? store.locate(where, diagram_id) : where;
        const existing = diagram_id ? store.load(located.dir, diagram_id) : undefined;
        const llm = lmStudio();
        const max = max_iterations ?? MAX_ITERATIONS;
        let r;
        try {
          r = await draw({
            llm,
            request,
            existing,
            provider,
            direction,
            maxIterations: max,
            onProgress: progressFn(extra),
          });
        } catch (e) {
          if (e instanceof LlmError) {
            throw new Error(`${e.message}\nFallback: write the spec yourself and call create_diagram (no LLM needed).`);
          }
          throw e;
        }
        t.set("pipeline", {
          llm: llm.label,
          plan: r.plan,
          interpret_ms: r.interpret_ms,
          dropped_icons: r.dropped,
          stopped: r.stopped,
          iterations: r.iterations,
        });
        const id = diagram_id ?? store.idFor(name ?? r.spec.title ?? "diagram");
        const verb = diagram_id ? "Updated" : store.exists(located.dir, id) ? "Replaced" : "Created";
        const out = result(t, located, id, r.spec, verb, r.notes);
        out.content.push({ type: "text", text: summarize(r, max) });
        return out;
      },
    ),
  );
}
