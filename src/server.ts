import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDiagramTools } from "./tools/diagrams.js";
import { registerDrawTool } from "./tools/draw.js";
import { VERSION } from "./tools/shared.js";
import { registerSupportTools } from "./tools/support.js";

/** Shown to the model by the client. Keep it short and imperative: it shapes every diagram request. */
const INSTRUCTIONS = [
  "Diagram rules for good output:",
  "(1) every service/actor is a node with an icon (provider:name, see list_icons);",
  "(2) labels are 1-3 words, extra text goes in `detail`;",
  "(3) at most ~12 nodes: collapse internal code steps into one node;",
  "(4) edge labels 1-3 words;",
  "(5) show returns and loops: a call that returns data gets a dashed return edge (or bidirectional), a feedback loop gets an edge back to the step it improves; number sequential steps in edge labels ('1. fetch', '2. recall'): they are laid out in that order;",
  "(6) use groups for boundaries (VPC, Lambda, region);",
  "(7) ALWAYS pass output_dir = absolute path of the user's project folder, so the PNG lands in <project>/.diagram-mcp/;",
  "(8) to change a diagram call update_diagram, never create a copy; after create, read the returned notes and fix them with update_diagram;",
  "(9) to let the server design it from plain words (interpreter + reviewer loop, max 5 passes) call draw_diagram;",
  "(10) every result ends with a log_id: when something looks wrong, call get_log with it (or ask the user to share it) before guessing.",
].join(" ");

export function createServer(): McpServer {
  const server = new McpServer({ name: "diagram-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
  registerDiagramTools(server);
  registerDrawTool(server);
  registerSupportTools(server);
  return server;
}
