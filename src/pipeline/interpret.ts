/**
 * Request interpreter: plain-language request -> diagram plan (type, direction, icons, nodes, edges, groups).
 * The LLM decides; code then validates icons against the real catalog and repairs what it can.
 */
import { z } from "zod";
import { searchIcons, resolveIcon } from "../icons/index.js";
import { SpecSchema, type Spec } from "../core/model.js";
import type { Llm } from "./llm.js";

export const PlanSchema = SpecSchema.extend({
  diagram_type: z
    .enum(["architecture", "flow"])
    .describe("architecture = cloud/system components; flow = process or decision steps"),
  direction: z.enum(["LR", "TB"]),
  direction_reason: z.string().describe("One sentence: why this direction fits the request"),
});
export type Plan = z.infer<typeof PlanSchema>;

const CORE_GENERAL = [
  "user",
  "users",
  "server",
  "database",
  "mail",
  "bell",
  "search",
  "brain",
  "bot",
  "file-text",
  "book-open",
  "clock",
  "shield-check",
  "key-round",
  "globe",
  "settings",
  "workflow",
  "cog",
  "history",
  "credit-card",
  "message-square",
  "scroll-text",
];

/** A short, relevant slice of the icon catalog so the model picks real names instead of inventing them. */
export function iconCatalog(request: string, provider?: string): string[] {
  const words = [
    ...new Set(
      request
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    ),
  ];
  const out = new Set<string>();
  const add = (ic: { provider: string; category: string; name: string }) =>
    out.add(ic.provider === "general" ? `general:${ic.name}` : `${ic.provider}:${ic.category}/${ic.name}`);
  const providers = [provider, "aws", "gcp", "azure", "onprem", "saas", "general"].filter(
    (p, i, a): p is string => !!p && a.indexOf(p) === i,
  );
  for (const w of words) {
    for (const p of providers) {
      for (const ic of searchIcons(w, p, 3)) add(ic);
      if (out.size > 90) break;
    }
  }
  for (const n of CORE_GENERAL) {
    const ic = resolveIcon(`general:${n}`);
    if (ic) add(ic);
  }
  for (const n of [
    "lambda",
    "api-gateway",
    "dynamodb",
    "s3",
    "sqs",
    "sns",
    "appsync",
    "bedrock",
    "cloudwatch",
    "eventbridge",
  ]) {
    const ic = resolveIcon(`aws:${n}`);
    if (ic && provider !== "gcp" && provider !== "azure") add(ic);
  }
  return [...out];
}

export const GUIDELINES = `Diagram rules:
- One node per real component or actor in the request. Do not invent components.
- At most 12 nodes: merge fine-grained steps into one node and put the detail in "detail".
- label: 1-3 words. detail: short subtext. id: lowercase-kebab.
- Every service, store, actor gets an icon from the CATALOG (exact string). Product names must map to their own icon (Bedrock -> aws:ml/bedrock, DynamoDB -> aws:database/dynamodb, MongoDB -> onprem:database/mongodb). Everyday concepts use general:* icons.
- Pure process steps with no product: no icon, shape "box"; decisions "diamond"; start/end "pill".
- Edges: label 1-3 words. Number sequential steps in the label ("1. fetch", "2. recall"). A call that returns data gets bidirectional true or a dashed return edge. A feedback loop gets a dashed edge back to the step it improves.
- Groups for real boundaries (VPC, Lambda, Region, data tier). children are node or group ids. A node is in at most one group.
- direction: LR for a request/response pipeline with a clear left-to-right sequence of up to ~7 stages. TB for layered architectures, hierarchies, decision flows, or long sequences that would make a wide ribbon.`;

const EXAMPLE = `Example of the JSON shape (abbreviated):
{"diagram_type":"architecture","direction":"LR","direction_reason":"Linear request path","title":"Order API","provider":"aws",
"nodes":[{"id":"user","label":"Customer","icon":"aws:general/user"},{"id":"api","label":"API Gateway","icon":"aws:network/api-gateway"},{"id":"fn","label":"Order Lambda","icon":"aws:compute/lambda"},{"id":"db","label":"Orders","detail":"DynamoDB","icon":"aws:database/dynamodb"}],
"edges":[{"from":"user","to":"api","label":"HTTPS"},{"from":"api","to":"fn","label":"1. invoke"},{"from":"fn","to":"db","label":"2. read/write","bidirectional":true}],
"groups":[{"id":"aws","label":"AWS Cloud","children":["api","fn","db"]}]}`;

export async function interpret(
  llm: Llm,
  req: { request: string; existing?: Spec; provider?: "aws" | "gcp" | "azure"; direction?: "LR" | "TB" },
): Promise<{ plan: Plan; spec: Spec; ms: number; dropped: string[] }> {
  const catalog = iconCatalog(req.request, req.provider);
  const system = [
    "You turn a plain-language request into a diagram specification for a renderer. Reply with one JSON object only.",
    GUIDELINES,
    EXAMPLE,
    req.provider ? `Default cloud: ${req.provider}.` : "",
    req.direction ? `The user fixed the direction to ${req.direction}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const user = [
    req.existing
      ? `CURRENT DIAGRAM (keep ids of unchanged nodes; return the COMPLETE new spec):\n${JSON.stringify(req.existing)}\n\nCHANGE REQUEST:\n${req.request}`
      : `REQUEST:\n${req.request}`,
    `CATALOG (use these exact icon strings):\n${catalog.join("\n")}`,
  ].join("\n\n");

  const { value, ms } = await llm.json({ name: "diagram_plan", system, user, schema: PlanSchema });
  const dropped: string[] = [];
  const { diagram_type: _t, direction_reason: _r, ...spec } = value;
  for (const n of spec.nodes) {
    if (n.icon && !resolveIcon(n.icon)) {
      dropped.push(`${n.id}: unknown icon '${n.icon}'`);
      n.icon = undefined; // understand() will infer one from the label instead
    }
  }
  if (req.direction) spec.direction = req.direction;
  return { plan: value, spec, ms, dropped };
}
