import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchIcons } from "../icons/index.js";
import { Trace, homeDir, readLog } from "../core/logs.js";
import { OUTPUT_DIR, fail, outDir } from "./shared.js";

/** Read-only helpers: icon search and debug logs. They write no logs themselves. */
export function registerSupportTools(server: McpServer): void {
  server.registerTool(
    "get_log",
    {
      description:
        "Return the debug log of an earlier tool call by log_id (every result ends with one), or the latest log if omitted. " +
        "Contains the exact input received, where files were written and why, inferred icons, notes and errors. Use it to debug a wrong or missing diagram.",
      inputSchema: {
        log_id: z.string().optional().describe("e.g. 20261008-170312-ab12, or 'latest'"),
        output_dir: OUTPUT_DIR,
      },
    },
    async ({ log_id, output_dir }) => {
      try {
        const dirs = [(await outDir(server, new Trace("get_log", {}), output_dir)).dir, homeDir()];
        const { file, text } = readLog([...new Set(dirs)], log_id);
        return { content: [{ type: "text" as const, text: `${file}\n${text}` }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_icons",
    {
      description:
        "Search available icons. Use the returned `provider:name` (or `provider:category/name`) as node.icon.",
      inputSchema: {
        provider: z.enum(["aws", "gcp", "azure", "general", "generic", "onprem", "saas", "k8s"]).optional(),
        query: z.string().optional().describe("Substring, e.g. 'lambda', 'database', 'queue'"),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async ({ provider, query, limit }) => {
      const hits = searchIcons(query, provider, limit ?? 60);
      return {
        content: [
          {
            type: "text" as const,
            text: hits.length
              ? hits.map((i) => `${i.provider}:${i.name}\t(${i.category})`).join("\n")
              : "No icons matched.",
          },
        ],
      };
    },
  );
}
