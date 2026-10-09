// Live check of draw_diagram against a running LM Studio. Usage: npm run live -- "request text"
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const request =
  process.argv[2] ??
  "An engineer opens the triage dashboard and sends a ticket id plus a symptom to AppSync. AppSync invokes the triage Lambda. The Lambda runs four steps in order: 1) fetch context through a db-access Lambda from a MongoDB tickets database, 2) recall confirmed past cases from a DynamoDB feedback table, 3) select matching runbooks bundled at build time, 4) reason over everything with Amazon Bedrock. The diagnosis goes back to the engineer, who marks it correct or incorrect; that verdict is stored in the DynamoDB feedback table and improves step 2 next time.";

fs.mkdirSync("out/live", { recursive: true });
const client = new Client({ name: "live", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: [process.cwd() + "/dist/index.js"],
    env: process.env as Record<string, string>,
  }),
);
const t0 = Date.now();
const r: any = await client.callTool(
  {
    name: "draw_diagram",
    arguments: {
      request,
      name: "live-demo",
      output_dir: process.cwd() + "/out/live",
      max_iterations: Number(process.env.ITER ?? 5),
    },
  },
  undefined,
  { timeout: 1_800_000, onprogress: (p) => console.log(`  progress ${p.progress}/${p.total}: ${p.message}`) },
);
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s, error=${!!r.isError}`);
for (const c of r.content) {
  if (c.type === "image") fs.writeFileSync("out/live/result.png", Buffer.from(c.data, "base64"));
  else console.log(c.text);
}
await client.close();
