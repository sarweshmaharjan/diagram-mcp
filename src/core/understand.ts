/**
 * "Understand" step: deterministic clean-up of the spec the client LLM sent, before layout.
 * No LLM here (the calling model already is one). It
 *   1. infers service icons from labels  ("Amazon Bedrock (tool-call output)" -> aws:ml/bedrock)
 *   2. splits long labels into label + detail
 *   3. returns lint notes so the caller can fix a cluttered spec with update_diagram
 */
import { allIcons, iconsOf, resolveIcon, type IconEntry } from "../icons/index.js";
import type { Spec } from "./model.js";

type Provider = "aws" | "gcp" | "azure";

// Things people say that are not literally an icon name. First match wins.
const SYNONYMS: [RegExp, string][] = [
  [
    /\b(engineer|developer|dev|user|users|customer|customers|person|operator|admin|analyst|actor)s?\b/i,
    "aws:general/user",
  ],
  [/\b(browser|web ?app|frontend|front-end|spa|portal|ui)\b/i, "aws:general/client"],
  [/\b(mobile ?app|ios|android|phone)\b/i, "aws:general/mobile-client"],
  [/\bmongo(db)?\b/i, "onprem:database/mongodb"],
  [/\b(postgres|postgresql)\b/i, "onprem:database/postgresql"],
  [/\bmysql\b/i, "onprem:database/mysql"],
  [/\bredis\b/i, "onprem:inmemory/redis"],
  [/\bkafka\b/i, "onprem:queue/kafka"],
  [/\bgithub\b/i, "onprem:vcs/github"],
  [/\bslack\b/i, "saas:chat/slack"],
  [/\b(llm|foundation model|claude)\b/i, "aws:ml/bedrock"],
  [/\bdynamo\b/i, "aws:database/dynamodb"],
  [/\bapi gw\b/i, "aws:network/api-gateway"],
  [/\bgraphql\b/i, "aws:integration/appsync"],
  [/\bcloud ?watch\b/i, "aws:management/cloudwatch"],
  [/\bk8s|kubernetes\b/i, "k8s:compute/pod"],
];

// Everyday concepts -> general (Lucide) icon, used when no cloud/product icon matched. First match wins.
const GENERAL: [RegExp, string][] = [
  [/\b(e-?mail|smtp|mailer)\b/i, "mail"],
  [/\b(notif\w*|push|alerting)\b/i, "bell"],
  [/\b(sms|text message)\b/i, "message-square"],
  [/\b(chat|conversation)\b/i, "messages-square"],
  [/\b(webhook|callback)s?\b/i, "webhook"],
  [/\b(queue|backlog|buffer)\b/i, "list-ordered"],
  [/\b(cache|caching)\b/i, "zap"],
  [/\b(schedul\w*|cron|timer)\b/i, "calendar-clock"],
  [/\b(pdf|report|document|doc|docs|invoice)s?\b/i, "file-text"],
  [/\b(runbook|playbook|guide|knowledge|wiki|manual)s?\b/i, "book-open"],
  [/\b(evidence|investigat\w*|inspect\w*|forensic\w*)\b/i, "file-search"],
  [/\b(search|lookup|find|retriev\w*|recall)\b/i, "search"],
  [/\b(reason\w*|think\w*|diagnos\w*|analy[sz]\w*)\b/i, "brain"],
  [/\b(ai|ml|model|agent|bot|assistant|copilot)\b/i, "bot"],
  [/\b(auth\w*|login|log-in|sso|identity|oauth|jwt)\b/i, "shield-check"],
  [/\b(secret|credential|token|api key|password)s?\b/i, "key-round"],
  [/\b(encrypt\w*|lock|vault)\b/i, "lock"],
  [/\b(rule|policy|policies|compliance)s?\b/i, "scroll-text"],
  [/\b(logs?|logging|audit)\b/i, "scroll-text"],
  [/\b(dashboard|metrics?|analytics|kpi|insights?)\b/i, "chart-column"],
  [/\b(payment|billing|checkout|stripe)\b/i, "credit-card"],
  [/\b(cart|orders?)\b/i, "shopping-cart"],
  [/\b(config\w*|settings?|preferences?)\b/i, "settings"],
  [/\b(terminal|cli|shell|command line)\b/i, "terminal"],
  [/\b(code|script|sdk|library)\b/i, "code-xml"],
  [/\b(feedback|review|rating|survey)s?\b/i, "thumbs-up"],
  [/\b(error|fail\w*|exception|fault|reject\w*)\b/i, "triangle-alert"],
  [/\b(success|done|complete\w*|approved?|valid\w*|verified)\b/i, "circle-check"],
  [/\b(start|begin|launch|trigger\w*)\b/i, "play"],
  [/\b(decision|branch|route|router|switch)\b/i, "git-branch"],
  [/\b(etl|transform\w*|convert\w*|pipeline|workflow|orchestrat\w*)\b/i, "workflow"],
  [/\b(sync\w*|replicat\w*|refresh)\b/i, "refresh-cw"],
  [/\b(upload\w*|ingest\w*|import\w*)\b/i, "upload"],
  [/\b(download\w*|export\w*)\b/i, "download"],
  [/\b(batch|jobs?|tasks?|worker|workers|processor)\b/i, "cog"],
  [/\b(device|iot|sensor|edge)s?\b/i, "cpu"],
  [/\b(image|photo|picture|screenshot)s?\b/i, "image"],
  [/\bvideo\b/i, "video"],
  [/\b(map|location|geo\w*|address)\b/i, "map-pin"],
  [/\b(print\w*)\b/i, "printer"],
  [/\b(internet|website|web|public|external)\b/i, "globe"],
  [/\b(file|files|storage|bucket|blob)\b/i, "hard-drive"],
  [/\b(server|backend|service|api|endpoint|rest|http)\b/i, "server"],
  [/\b(database|db|datastore|table|tables|collection|collections)\b/i, "database"],
  [/\b(time|clock|ttl|expir\w*)\b/i, "clock"],
];

function inferGeneral(text: string): IconEntry | undefined {
  for (const [re, name] of GENERAL) {
    if (re.test(text)) {
      const hit = resolveIcon(`general:${name}`);
      if (hit) return hit;
    }
  }
  // last resort: a word that is exactly a general icon name ("rocket", "flag", "heart")
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  const names = new Map(
    allIcons()
      .filter((i) => i.provider === "general")
      .map((i) => [i.name, i]),
  );
  for (const w of words) if (names.has(w)) return names.get(w);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
// Names that appear inside ordinary words/phrases and give false positives.
const STOP = new Set([
  "generic",
  "blank",
  "general",
  "client",
  "users",
  "user",
  "compute",
  "database",
  "storage",
  "network",
  "internet",
  "marketplace",
  "alexa",
  "console",
  "organizations",
  "error",
  "service",
  "services",
  "data",
  "event",
  "events",
  "config",
  "queue",
  "function",
  "monitoring",
  "security",
  "logs",
  "tools",
  "tool",
  "api",
  "app",
  "apps",
  "cache",
  "key",
  "keys",
  "job",
  "jobs",
  "task",
  "tasks",
  "alert",
  "alerts",
  "stream",
  "pipeline",
  "workflow",
]);

function providerHint(text: string): Provider | undefined {
  if (/\b(gcp|google|bigquery|gke|pub\/?sub|cloud run)\b/i.test(text)) return "gcp";
  if (/\b(azure|aks|cosmos ?db|app service)\b/i.test(text)) return "azure";
  if (/\b(aws|amazon)\b/i.test(text)) return "aws";
}

export function inferIcon(text: string, main: Provider, withGeneral = true): IconEntry | undefined {
  for (const [re, ref] of SYNONYMS) {
    if (re.test(text)) {
      const hit = resolveIcon(ref);
      if (hit) return hit;
    }
  }
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const flat = norm(text);
  const hint = providerHint(text);
  const first = hint ?? main;
  // other clouds only when the text names them; otherwise generic words ("error") match random icons
  const order = [
    first,
    "onprem",
    "saas",
    ...(hint ? (["aws", "gcp", "azure"] as const).filter((p) => p !== first) : []),
  ];
  for (const prov of order) {
    let best: IconEntry | undefined;
    for (const ic of iconsOf(prov)) {
      const n = norm(ic.name);
      if (n.length < 2 || STOP.has(n)) continue;
      // short names (s3, sqs, ecs) must be a whole word; long names can be a substring ("dynamodbtable")
      const hit = n.length < 5 ? words.has(ic.name) || words.has(n) : flat.includes(n);
      if (hit && (!best || n.length > norm(best.name).length)) best = ic;
    }
    if (best) return best;
  }
  return withGeneral ? inferGeneral(text) : undefined;
}

/** "Amazon Bedrock (tool-call output)" -> ["Amazon Bedrock", "tool-call output"]; "1. Recall\nconfirmed cases" -> 2 parts. */
export function splitLabel(label: string): [string, string?] {
  const nl = label.split(/\\n|\n/);
  if (nl.length > 1) return [nl[0].trim(), nl.slice(1).join(" ").trim()];
  if (label.length <= 20) return [label];
  const m = /^(.{3,26}?)\s*(?:\(|:|—|–| - )\s*(.+?)\)?$/.exec(label);
  return m ? [m[1].trim(), m[2].trim()] : [label];
}

function majorityProvider(spec: Spec): Provider {
  if (spec.provider) return spec.provider;
  const count: Record<string, number> = {};
  for (const n of spec.nodes) {
    const p = n.icon?.split(":")[0];
    if (p) count[p] = (count[p] ?? 0) + 1;
  }
  const top = Object.entries(count)
    .filter(([p]) => p === "aws" || p === "gcp" || p === "azure")
    .sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0] as Provider;
  const hint = providerHint(spec.nodes.map((n) => n.label ?? n.id).join(" "));
  return hint ?? "aws";
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export function understand(input: Spec): { spec: Spec; notes: string[] } {
  const spec: Spec = structuredClone(input);
  const notes: string[] = [];
  const main = majorityProvider(spec);
  const auto: string[] = [];

  for (const n of spec.nodes) {
    const flow = n.shape === "diamond" || (n.shape === "pill" && !!n.color);
    const shaped = !!n.shape; // explicit flowchart shape: only product/actor icons, never generic glyphs
    if (!n.icon && !flow) {
      const ic = inferIcon(`${n.label ?? n.id.replace(/[-_]/g, " ")} ${n.detail ?? ""}`, main, !shaped);
      if (ic) {
        n.icon = `${ic.provider}:${ic.category}/${ic.name}`;
        auto.push(`${n.id}→${n.icon}`);
      }
    }
    const [label, detail] = splitLabel(n.label ?? n.id);
    if (detail && !n.detail) {
      n.label = label;
      n.detail = detail;
    }
    if (n.detail) n.detail = clip(n.detail, 60);
  }
  for (const e of spec.edges) if (e.label) e.label = clip(e.label, 28);

  if (auto.length) notes.push(`Auto-assigned icons: ${auto.join(", ")}. Override with update_nodes if wrong.`);
  const plain = spec.nodes.filter((n) => !n.icon && n.shape !== "diamond" && n.shape !== "pill");
  if (plain.length > 2 && plain.length >= spec.nodes.length / 2) {
    notes.push(
      `${plain.length} nodes have no icon (${plain.map((n) => n.id).join(", ")}). Give services an icon or collapse internal steps into one node with a detail.`,
    );
  }
  if (spec.nodes.length > 14)
    notes.push(
      `${spec.nodes.length} nodes is dense. Collapse sub-steps or split into two diagrams (overview + detail).`,
    );
  for (const g of spec.groups)
    if (g.children.length > 8) notes.push(`Group '${g.id}' has ${g.children.length} children; consider sub-groups.`);
  // request-like edge into a node that never answers: usually a missing return/loop edge
  const outdeg = new Set(spec.edges.map((e) => e.from));
  const silent = new Set<string>();
  for (const e of spec.edges) {
    if (
      !outdeg.has(e.to) &&
      /^\s*(\d+[.)]|[a-z][.)])|read|query|fetch|get|invoke|call|lookup|recall|load|evidence/i.test(e.label ?? "")
    )
      silent.add(e.to);
  }
  if (silent.size)
    notes.push(
      `Nothing returns from: ${[...silent].join(", ")}. If they send data back, add a dashed return edge (or bidirectional) so the flow reads end to end.`,
    );
  const connected = new Set(spec.edges.flatMap((e) => [e.from, e.to]));
  const lone = spec.nodes.filter((n) => !connected.has(n.id)).map((n) => n.id);
  if (lone.length && spec.nodes.length > 1) notes.push(`Unconnected nodes: ${lone.join(", ")}.`);
  return { spec, notes };
}
