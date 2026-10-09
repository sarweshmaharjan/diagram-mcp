// End-to-end check: spawn the built server over stdio, create then update a diagram, write PNGs to ./out
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

fs.mkdirSync("out/ws", { recursive: true });
const client = new Client({ name: "smoke", version: "0" });
await client.connect(
  new StdioClientTransport({
    command: "node",
    args: [process.cwd() + "/dist/index.js"],
    cwd: "out/ws",
    env: process.env as Record<string, string>,
  }),
);
console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));

const save = (r: any, f: string) => {
  const img = r.content.find((c: any) => c.type === "image");
  if (img) fs.writeFileSync(f, Buffer.from(img.data, "base64"));
  console.log(
    r.isError ? "ERROR" : "ok",
    r.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ")
      .slice(0, 300),
  );
};

const r1: any = await client.callTool({
  name: "create_diagram",
  arguments: {
    title: "Serverless API",
    direction: "LR",
    nodes: [
      { id: "user", label: "Users", icon: "aws:users" },
      { id: "cf", label: "CloudFront", icon: "aws:cloudfront" },
      { id: "apigw", label: "API Gateway", icon: "aws:api-gateway" },
      { id: "fn", label: "Order Lambda", icon: "aws:lambda" },
      { id: "ddb", label: "Orders Table", icon: "aws:dynamodb" },
      { id: "q", label: "Order Queue", icon: "aws:sqs" },
    ],
    edges: [
      { from: "user", to: "cf" },
      { from: "cf", to: "apigw", label: "HTTPS" },
      { from: "apigw", to: "fn" },
      { from: "fn", to: "ddb", label: "read/write" },
      { from: "fn", to: "q", style: "dashed" },
    ],
    groups: [{ id: "aws", label: "AWS Cloud", color: "#FF9900", children: ["cf", "apigw", "fn", "ddb", "q"] }],
  },
});
save(r1, "out/1-create.png");
const id = /diagram_id=(\S+)/.exec(r1.content[1].text)![1];

save(
  await client.callTool({
    name: "update_diagram",
    arguments: {
      diagram_id: id,
      add_nodes: [
        { id: "w", label: "Worker", icon: "aws:lambda" },
        { id: "s3", label: "Archive", icon: "aws:s3" },
      ],
      add_edges: [
        { from: "q", to: "w" },
        { from: "w", to: "s3" },
      ],
      update_nodes: [{ id: "fn", label: "Order API" }],
      add_groups: [{ id: "async", label: "Async processing", children: ["q", "w", "s3"] }],
    },
  }),
  "out/2-update.png",
);

save(
  await client.callTool({
    name: "create_diagram",
    arguments: {
      title: "Checkout flow",
      direction: "TB",
      nodes: [
        { id: "s", label: "Start", shape: "pill", color: "#C8E6C9" },
        { id: "c", label: "Cart valid?", shape: "diamond" },
        { id: "p", label: "Charge card" },
        { id: "e", label: "Show error", color: "#FFCDD2" },
        { id: "d", label: "Done", shape: "pill", color: "#C8E6C9" },
      ],
      edges: [
        { from: "s", to: "c" },
        { from: "c", to: "p", label: "yes" },
        { from: "c", to: "e", label: "no" },
        { from: "p", to: "d" },
        { from: "e", to: "d" },
      ],
    },
  }),
  "out/3-flow.png",
);

save(
  await client.callTool({
    name: "create_diagram",
    arguments: {
      title: "Multi-cloud",
      direction: "LR",
      nodes: [
        { id: "a", label: "AKS", icon: "azure:aks" },
        { id: "g", label: "GKE", icon: "gcp:gke" },
        { id: "b", label: "BigQuery", icon: "gcp:bigquery" },
        { id: "x", label: "bad", icon: "aws:lamdba" },
      ],
      edges: [
        { from: "a", to: "g" },
        { from: "g", to: "b" },
      ],
    },
  }),
  "out/4-error.png",
);
save(
  await client.callTool({
    name: "create_diagram",
    arguments: {
      title: "Support Ticket Triage - Request Flow",
      nodes: [
        { id: "eng", label: "Engineer\n/triage", shape: "pill" },
        { id: "as", label: "AppSync query (authenticated)" },
        { id: "chk", label: "referenceId + symptom?", shape: "diamond" },
        { id: "err", label: "stageErrors: config", shape: "pill", color: "#FFCDD2" },
        { id: "ev", label: "1. Evidence\nfetchContext" },
        { id: "db", label: "*-db-access Lambda" },
        { id: "mongo", label: "Tickets DB (MongoDB)" },
        { id: "rc", label: "2. Recall confirmed cases" },
        { id: "rb", label: "3. selectRunbooks (bundled, pure)" },
        { id: "rs", label: "4. Reasoning: playbook + evidence + cases + runbooks" },
        { id: "bed", label: "Amazon Bedrock (tool-call output)" },
        { id: "dx", label: "Diagnosis payload rootCause / resolution / unblockAction + stageErrors", shape: "pill" },
        { id: "fb", label: "DiagnosisFeedback (DynamoDB, TTL)" },
      ],
      edges: [
        { from: "eng", to: "as" },
        { from: "as", to: "chk" },
        { from: "chk", to: "ev", label: "yes" },
        { from: "chk", to: "err", label: "no" },
        { from: "ev", to: "db", label: "invoke" },
        { from: "db", to: "mongo" },
        { from: "ev", to: "rc", label: "degrade on error" },
        { from: "rc", to: "rb", label: "degrade on error" },
        { from: "rb", to: "rs" },
        { from: "rs", to: "bed", label: "invokeModel" },
        { from: "rs", to: "dx" },
        { from: "dx", to: "fb", label: "write (learning loop)" },
        { from: "rc", to: "fb", label: "read", style: "dashed" },
      ],
      groups: [{ id: "lam", label: "triage Lambda (no VPC)", children: ["chk", "err", "ev", "rc", "rb", "rs"] }],
    },
  }),
  "out/5-flowchart.png",
);
const wsAbs = process.cwd() + "/out/ws-explicit";
fs.mkdirSync(wsAbs, { recursive: true });
const g: any = await client.callTool({
  name: "create_diagram",
  arguments: {
    title: "General icons",
    output_dir: wsAbs,
    nodes: [
      { id: "a", label: "Email service" },
      { id: "b", label: "Scheduler" },
      { id: "c", label: "Redis cache" },
      { id: "d", label: "Job queue" },
      { id: "e", label: "Search" },
      { id: "f", label: "Reasoning" },
      { id: "h", label: "Dashboard" },
      { id: "i", label: "Webhook" },
      { id: "j", label: "Auth" },
      { id: "k", label: "Config" },
      { id: "l", label: "Report PDF" },
      { id: "m", label: "Rocket launch" },
    ],
    edges: [
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["d", "e"],
      ["e", "f"],
      ["f", "h"],
      ["h", "i"],
      ["i", "j"],
      ["j", "k"],
      ["k", "l"],
      ["l", "m"],
    ].map(([from, to]) => ({ from, to })),
  },
});
save(g, "out/6-general.png");
const gid = /diagram_id=(\S+)/.exec(g.content[1].text)![1];
console.log("explicit dir has:", fs.readdirSync(wsAbs + "/.diagram-mcp").join(", "));
save(
  await client.callTool({
    name: "update_diagram",
    arguments: {
      diagram_id: gid,
      output_dir: wsAbs,
      update_nodes: [{ id: "m", label: "Rocket launch", icon: "general:rocket" }],
    },
  }),
  "out/7-general-upd.png",
);
console.log(
  "bad dir:",
  ((await client.callTool({ name: "list_diagrams", arguments: { output_dir: "relative/x" } })) as any).content[0].text,
);
// replace-by-name: same name twice must give ONE file; hub with numbered calls must be laid out 1-2-3-4
for (let k = 0; k < 2; k++) {
  const r: any = await client.callTool({
    name: "create_diagram",
    arguments: {
      name: "hub-order",
      title: "Numbered calls" + (k ? " v2" : ""),
      output_dir: wsAbs,
      nodes: [
        { id: "h", label: "Orchestrator", icon: "aws:lambda" },
        { id: "s1", label: "Evidence", icon: "general:file-search" },
        { id: "s2", label: "Recall", icon: "general:search" },
        { id: "s3", label: "Runbooks", icon: "general:book-open" },
        { id: "s4", label: "Reasoning", icon: "aws:bedrock" },
      ],
      edges: [
        { from: "h", to: "s4", label: "4. reason" },
        { from: "h", to: "s2", label: "2. recall" },
        { from: "h", to: "s1", label: "1. evidence" },
        { from: "h", to: "s3", label: "3. select" },
      ],
    },
  });
  if (k) save(r, "out/8-hub-order.png");
}
console.log(
  "files after 2x create same name:",
  fs
    .readdirSync(wsAbs + "/.diagram-mcp")
    .filter((f) => f.startsWith("hub-order"))
    .join(", "),
);

const demo: any = await client.callTool({
  name: "create_diagram",
  arguments: {
    name: "triage-flow",
    title: "Support Ticket Triage",
    output_dir: wsAbs,
    direction: "LR",
    nodes: [
      { id: "eng", label: "Engineer" },
      { id: "ui", label: "Dashboard", detail: "/triage", icon: "aws:amplify" },
      { id: "as", label: "AppSync", icon: "aws:appsync" },
      { id: "s1", label: "1. Evidence", detail: "fetchContext", icon: "general:file-search" },
      { id: "s2", label: "2. Recall", detail: "confirmed cases", icon: "general:history" },
      { id: "s3", label: "3. Runbooks", detail: "keyword match", icon: "general:book-open" },
      { id: "s4", label: "4. Reason", detail: "playbook + evidence", icon: "general:brain" },
      { id: "rb", label: "Runbooks", detail: ".ai/runbooks/*.md", icon: "general:file-text" },
      { id: "db", label: "db-access", icon: "aws:lambda" },
      { id: "mongo", label: "Tickets DB", detail: "ticket history" },
      { id: "bed", label: "Bedrock", icon: "aws:bedrock" },
      { id: "ddb", label: "DiagnosisFeedback", detail: "verdicts, TTL", icon: "aws:dynamodb" },
    ],
    edges: [
      { from: "eng", to: "ui", label: "refId + symptom" },
      { from: "ui", to: "as", label: "debug query" },
      { from: "as", to: "s1", label: "invoke" },
      { from: "s1", to: "db", label: "fetch", bidirectional: true },
      { from: "db", to: "mongo", bidirectional: true },
      { from: "s1", to: "s2" },
      { from: "s2", to: "s3" },
      { from: "s3", to: "s4" },
      { from: "ddb", to: "s2", label: "correct cases", style: "dashed" },
      { from: "rb", to: "s3", label: "bundled", style: "dashed" },
      { from: "s4", to: "bed", label: "InvokeModel", bidirectional: true },
      { from: "s4", to: "as", label: "diagnosis", style: "dashed" },
      { from: "as", to: "ddb", label: "engineer verdict" },
    ],
    groups: [
      { id: "lam", label: "triage Lambda", children: ["s1", "s2", "s3", "s4"] },
      { id: "data", label: "Data tier", children: ["db", "mongo"] },
    ],
  },
});
save(demo, "out/9-pipeline.png");
// logs: success + failure both return a log_id, and get_log returns the record
const okLog = /log_id=(\S+?)[ (]/.exec(demo.content.at(-1).text)![1];
const rec: any = await client.callTool({ name: "get_log", arguments: { log_id: okLog, output_dir: wsAbs } });
const parsed = JSON.parse(rec.content[0].text.split("\n").slice(1).join("\n"));
console.log(
  "log ok:",
  okLog,
  parsed.tool,
  parsed.status,
  parsed.workspace.source,
  "keys:",
  Object.keys(parsed).join(","),
);
const bad: any = await client.callTool({
  name: "create_diagram",
  arguments: { name: "bad", output_dir: wsAbs, nodes: [{ id: "x", icon: "aws:lamdba" }] },
});
const badId = /log_id=(\S+?)[ (]/.exec(bad.content.at(-1).text)![1];
const badRec: any = await client.callTool({ name: "get_log", arguments: { log_id: badId, output_dir: wsAbs } });
const bp = JSON.parse(badRec.content[0].text.split("\n").slice(1).join("\n"));
console.log(
  "log err:",
  badId,
  bp.status,
  bp.error.message.split("\n")[0],
  "| latest ==",
  ((await client.callTool({ name: "get_log", arguments: { output_dir: wsAbs } })) as any).content[0].text.includes(
    badId,
  ),
);
console.log(
  "logs dir:",
  fs.readdirSync(wsAbs + "/.diagram-mcp/logs").length,
  "files; list_diagrams ignores logs:",
  JSON.parse(
    ((await client.callTool({ name: "list_diagrams", arguments: { output_dir: wsAbs } })) as any).content[0].text,
  ).length,
  "diagrams",
);
await client.close();
