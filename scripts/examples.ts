// Regenerates the images used in the README and docs by calling the built server over MCP.
// Usage: npm run build && npm run examples [name]   (the plain-language example needs LM Studio and is skipped if unreachable)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "diagram-mcp-examples-"));
const client = new Client({ name: "examples", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: [path.resolve("dist/index.js")],
    env: process.env as Record<string, string>,
  }),
);

const only = process.argv[2];
type Args = Record<string, unknown>;
async function make(tool: string, args: Args, name: string, dest: string): Promise<void> {
  if (only && only !== name) return;
  const r: any = await client.callTool({ name: tool, arguments: { ...args, name, output_dir: work } }, undefined, {
    timeout: 900_000,
  });
  if (r.isError) {
    console.log(`skip ${dest}: ${r.content[0].text.split("\n")[0]}`);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(work, ".diagram-mcp", `${name}.png`), dest);
  console.log(`wrote ${dest}`);
}

await make(
  "create_diagram",
  {
    title: "Serverless Orders API",
    direction: "LR",
    nodes: [
      { id: "user", label: "Customers", icon: "aws:users" },
      { id: "cf", label: "CloudFront", icon: "aws:cloudfront" },
      { id: "apigw", label: "API Gateway", icon: "aws:api-gateway" },
      { id: "fn", label: "Orders API", icon: "aws:lambda" },
      { id: "ddb", label: "Orders", detail: "DynamoDB", icon: "aws:dynamodb" },
      { id: "q", label: "Order Queue", icon: "aws:sqs" },
      { id: "w", label: "Fulfilment", icon: "aws:lambda" },
      { id: "s3", label: "Invoices", icon: "aws:s3" },
    ],
    edges: [
      { from: "user", to: "cf" },
      { from: "cf", to: "apigw", label: "HTTPS" },
      { from: "apigw", to: "fn" },
      { from: "fn", to: "ddb", label: "read/write", bidirectional: true },
      { from: "fn", to: "q", style: "dashed" },
      { from: "q", to: "w" },
      { from: "w", to: "s3" },
    ],
    groups: [
      { id: "aws", label: "AWS Cloud", children: ["cf", "apigw", "fn", "ddb", "async"] },
      { id: "async", label: "Async processing", children: ["q", "w", "s3"] },
    ],
  },
  "serverless-api",
  "examples/serverless-api.png",
);

await make(
  "create_diagram",
  {
    title: "Checkout Flow",
    direction: "TB",
    nodes: [
      { id: "s", label: "Start", shape: "pill" },
      { id: "c", label: "Cart valid?", shape: "diamond" },
      { id: "p", label: "Charge card" },
      { id: "e", label: "Show error", color: "#FFCDD2" },
      { id: "d", label: "Done", shape: "pill" },
    ],
    edges: [
      { from: "s", to: "c" },
      { from: "c", to: "p", label: "yes" },
      { from: "c", to: "e", label: "no" },
      { from: "p", to: "d" },
      { from: "e", to: "d" },
    ],
  },
  "checkout-flow",
  "examples/checkout-flow.png",
);

await make(
  "create_diagram",
  {
    title: "Event pipeline across clouds",
    direction: "LR",
    nodes: [
      { id: "app", label: "Web app", icon: "azure:aks", detail: "AKS" },
      { id: "ps", label: "Pub/Sub", icon: "gcp:pubsub" },
      { id: "bq", label: "BigQuery", icon: "gcp:bigquery" },
      { id: "dash", label: "Dashboard", icon: "general:chart-column" },
    ],
    edges: [
      { from: "app", to: "ps", label: "events" },
      { from: "ps", to: "bq", label: "stream" },
      { from: "bq", to: "dash" },
    ],
    groups: [
      { id: "az", label: "Azure", children: ["app"] },
      { id: "gc", label: "Google Cloud", children: ["ps", "bq"] },
    ],
  },
  "multi-cloud",
  "examples/multi-cloud.png",
);

await make(
  "create_diagram",
  {
    title: "diagram-mcp architecture",
    direction: "LR",
    nodes: [
      { id: "client", label: "MCP client", detail: "Kiro, Claude, Cursor", icon: "general:bot" },
      { id: "tools", label: "MCP tools", detail: "create, update, draw", icon: "general:plug" },
      { id: "u", label: "Understand", detail: "icons, labels, notes", icon: "general:wand-sparkles" },
      { id: "layout", label: "Layout", detail: "dagre", icon: "general:workflow" },
      { id: "render", label: "Render", detail: "SVG to PNG (resvg)", icon: "general:image" },
      { id: "store", label: "Project folder", detail: ".diagram-mcp/", icon: "general:folder" },
      { id: "logs", label: "Call logs", detail: "log_id per call", icon: "general:scroll-text" },
      { id: "interp", label: "Interpreter", detail: "request to spec", icon: "general:brain" },
      { id: "review", label: "Reviewer loop", detail: "max 5 passes", icon: "general:refresh-cw" },
      { id: "llm", label: "Local LLM", detail: "LM Studio", icon: "general:cpu" },
    ],
    edges: [
      { from: "client", to: "tools", label: "1. call" },
      { from: "tools", to: "u", label: "2. spec" },
      { from: "u", to: "layout" },
      { from: "layout", to: "render" },
      { from: "render", to: "store", label: "PNG + spec" },
      { from: "tools", to: "logs", style: "dashed" },
      { from: "tools", to: "interp", label: "draw_diagram", style: "dashed" },
      { from: "interp", to: "review" },
      { from: "interp", to: "llm", bidirectional: true, style: "dashed" },
      { from: "review", to: "llm", bidirectional: true, style: "dashed" },
      { from: "review", to: "u", label: "fixed spec", style: "dashed" },
    ],
    groups: [
      { id: "core", label: "Always on (no LLM)", children: ["u", "layout", "render", "store", "logs"] },
      { id: "plain", label: "Plain-language mode", children: ["interp", "review", "llm"] },
    ],
  },
  "architecture",
  "docs/architecture.png",
);

await make(
  "draw_diagram",
  {
    request:
      "A customer uploads a photo in a web app. The photo goes to an S3 bucket, which triggers a Lambda function. The Lambda calls Amazon Rekognition to detect unsafe content, then saves the result in DynamoDB. If the photo is safe, a second Lambda creates thumbnails and writes them back to S3. If it is unsafe, an SNS topic emails the moderators.",
    provider: "aws",
  },
  "plain-language",
  "examples/plain-language.png",
);

await client.close();
fs.rmSync(work, { recursive: true, force: true });
