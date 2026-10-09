/**
 * Feedback loop: review the diagram against the request, apply fixes, repeat.
 * Hard-capped at MAX_ITERATIONS reviews; also stops early when approved, when a pass changes nothing,
 * when a revision scores worse than the best so far, or when the LLM fails (best version so far is returned).
 */
import { z } from "zod";
import { UpdateSchema, applyUpdate, validate, type Spec, type Update } from "../core/model.js";
import { understand } from "../core/understand.js";
import { layoutSizes } from "../render/index.js";
import { GUIDELINES } from "./interpret.js";
import { LlmError, type Llm } from "./llm.js";

export const MAX_ITERATIONS = 5;
const APPROVE_SCORE = 8;

export const ReviewSchema = z.object({
  matches_request: z
    .boolean()
    .describe("true only if every component and relationship asked for is present and nothing is invented"),
  score: z.number().min(0).max(10),
  issues: z.array(z.object({ severity: z.enum(["blocker", "major", "minor"]), problem: z.string() })),
  ops: UpdateSchema.describe("Minimal edits that fix blocker and major issues. Empty object if none needed."),
});
export type Review = z.infer<typeof ReviewSchema>;

export interface Finding {
  source: "rules" | "llm";
  severity: "blocker" | "major" | "minor";
  problem: string;
}

export interface Iteration {
  n: number;
  score: number;
  matches_request: boolean;
  findings: Finding[];
  action: string; // what happened after the review
  llm_ms?: number;
}

export type StopReason = "approved" | "max_iterations" | "no_progress" | "regressed" | "llm_error";

/** Deterministic checks; they also propose a direct fix when there is an obvious one. */
export function ruleFindings(spec: Spec): { findings: Finding[]; fix?: Update } {
  const findings: Finding[] = [];
  let fix: Update | undefined;
  try {
    validate(understand(spec).spec);
  } catch (e) {
    // unusable spec (unknown ids, bad icons, ...): report it as the blocker and skip layout checks
    return {
      findings: [{ source: "rules", severity: "blocker", problem: (e as Error).message.replace(/\n- /g, "; ") }],
    };
  }
  const { notes } = understand(spec);
  for (const n of notes) {
    if (/^Auto-assigned/.test(n)) continue;
    findings.push({ source: "rules", severity: /dense|Unconnected/.test(n) ? "major" : "minor", problem: n });
  }
  for (const n of spec.nodes) {
    if ((n.label ?? n.id).length > 28 && !n.detail)
      findings.push({
        source: "rules",
        severity: "minor",
        problem: `Label of '${n.id}' is long; shorten it and move text to detail.`,
      });
  }
  const sizes = layoutSizes(spec);
  const cur =
    sizes[
      spec.direction ??
        (Math.abs(Math.log(sizes.LR.W / sizes.LR.H / 1.5)) <= Math.abs(Math.log(sizes.TB.W / sizes.TB.H / 1.5))
          ? "LR"
          : "TB")
    ];
  const ratio = cur.W / cur.H;
  if (ratio > 3.2 || ratio < 0.45) {
    const other = (spec.direction ?? "LR") === "LR" ? "TB" : "LR";
    const o = sizes[other];
    const oRatio = o.W / o.H;
    if (Math.abs(Math.log(oRatio / 1.5)) < Math.abs(Math.log(ratio / 1.5))) {
      findings.push({
        source: "rules",
        severity: "major",
        problem: `Canvas ${Math.round(cur.W)}x${Math.round(cur.H)} is too ${ratio > 1 ? "wide" : "tall"}; switching direction to ${other}.`,
      });
      fix = { direction: other };
    }
  }
  return { findings, fix };
}

const OPS_HELP = `ops format (all fields optional): {"title","direction":"LR|TB","add_nodes":[node],"update_nodes":[{"id",...changed fields}],"remove_nodes":[id],"add_edges":[edge],"remove_edges":[{"from","to"}],"add_groups":[group],"update_groups":[{"id",...}],"remove_groups":[id]}. Never rename ids. Use exact icon strings from the diagram or CATALOG.`;

async function review(
  llm: Llm,
  request: string,
  spec: Spec,
  rules: Finding[],
  previous: Finding[],
): Promise<{ review: Review; ms: number }> {
  const system = [
    "You are a strict reviewer of generated diagrams. Reply with one JSON object only.",
    "Judge the diagram against the user's request: (1) coverage: every component and relationship asked for is present, nothing invented; (2) readability: short labels, sensible icons for each service, numbered and ordered sequence, returns and feedback loops shown, sensible groups, fitting direction, not cluttered.",
    "Score 0-10 (8 or more = ready to ship). blocker = missing or wrong content; major = hard to read; minor = polish. Do not nitpick a good diagram: if it is ready, return an empty ops object.",
    GUIDELINES,
    OPS_HELP,
  ].join("\n\n");
  const user = [
    `REQUEST:\n${request}`,
    `CURRENT DIAGRAM SPEC:\n${JSON.stringify(spec)}`,
    rules.length ? `AUTOMATIC FINDINGS (already detected by code):\n- ${rules.map((f) => f.problem).join("\n- ")}` : "",
    previous.length
      ? `ISSUES FROM THE PREVIOUS REVIEW (check whether they are fixed; do not re-report fixed ones):\n- ${previous.map((f) => f.problem).join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const { value, ms } = await llm.json({ name: "diagram_review", system, user, schema: ReviewSchema });
  return { review: value, ms };
}

const blocking = (f: Finding[]) => f.some((x) => x.severity !== "minor");
const penalty = (f: Finding[]) =>
  f.reduce((s, x) => s + (x.severity === "blocker" ? 3 : x.severity === "major" ? 1.5 : 0.3), 0);
const key = (f: Finding[]) =>
  f
    .map((x) => `${x.severity}:${x.problem}`)
    .sort()
    .join("|");

export interface RefineResult {
  spec: Spec;
  iterations: Iteration[];
  stopped: StopReason;
  notes: string[];
}

export async function refine(opts: {
  llm: Llm;
  request: string;
  spec: Spec;
  maxIterations?: number;
  onProgress?: (i: number, total: number, msg: string) => void;
}): Promise<RefineResult> {
  const max = Math.min(Math.max(1, Math.floor(opts.maxIterations ?? MAX_ITERATIONS)), MAX_ITERATIONS);
  const iterations: Iteration[] = [];
  let cur = understand(opts.spec).spec;
  let best = { spec: cur, score: -Infinity };
  let prevFindings: Finding[] = [];
  let prevKey = "";
  let stopped: StopReason = "max_iterations";

  for (let n = 1; n <= max; n++) {
    opts.onProgress?.(n, max, `Reviewing diagram (pass ${n} of ${max})`);
    const rules = ruleFindings(cur);
    let rev: Review;
    let ms: number;
    try {
      ({ review: rev, ms } = await review(opts.llm, opts.request, cur, rules.findings, prevFindings));
    } catch (e) {
      if (!(e instanceof LlmError)) throw e;
      iterations.push({
        n,
        score: 0,
        matches_request: false,
        findings: rules.findings,
        action: `review failed: ${e.message}`,
      });
      stopped = "llm_error";
      break;
    }
    const findings: Finding[] = [...rules.findings, ...rev.issues.map((i) => ({ source: "llm" as const, ...i }))];
    const score = Math.max(0, Math.min(10, rev.score - penalty(rules.findings)));
    const approved = rev.matches_request && score >= APPROVE_SCORE && !blocking(findings);
    const it: Iteration = {
      n,
      score: Math.round(score * 10) / 10,
      matches_request: rev.matches_request,
      findings,
      action: "",
      llm_ms: ms,
    };
    iterations.push(it);

    if (n > 1 && score < best.score) {
      it.action = `score dropped (${it.score} < ${best.score}); reverting to the best version`;
      cur = best.spec;
      stopped = "regressed";
      break;
    }
    if (score >= best.score) best = { spec: cur, score };

    if (approved) {
      it.action = "approved";
      stopped = "approved";
      break;
    }
    if (n === max) {
      it.action = `iteration limit (${max}) reached`;
      stopped = "max_iterations";
      break;
    }
    const fp = key(findings);
    if (fp === prevKey) {
      it.action = "same issues as the previous pass; stopping";
      stopped = "no_progress";
      break;
    }
    prevKey = fp;
    prevFindings = findings;

    // apply fixes: rule fix first, then the LLM's ops; a bad edit becomes feedback, not a crash
    const before = JSON.stringify(cur);
    let next: Spec = cur;
    const applied: string[] = [];
    try {
      if (rules.fix) {
        next = applyUpdate(next, rules.fix);
        applied.push("direction");
      }
      const ops = rev.ops;
      if (Object.keys(ops).length) {
        next = applyUpdate(next, ops);
        applied.push("llm edits");
      }
      next = understand(next).spec;
      validate(next);
    } catch (e) {
      it.action = `edits rejected: ${(e as Error).message.split("\n").slice(0, 3).join(" ")}`;
      prevFindings = [
        ...findings,
        {
          source: "rules",
          severity: "major",
          problem: `Your last edits were rejected: ${(e as Error).message.split("\n")[1] ?? (e as Error).message}`,
        },
      ];
      continue; // keep `cur`, try again
    }
    if (JSON.stringify(next) === before) {
      it.action = "no changes proposed; stopping";
      stopped = "no_progress";
      break;
    }
    it.action = `applied ${applied.join(" + ")}`;
    cur = next;
  }

  // `best` is the highest-scoring version that was actually reviewed. Only when the very first review failed is there none.
  const finalSpec = best.score > -Infinity ? best.spec : cur;
  return { spec: finalSpec, iterations, stopped, notes: understand(finalSpec).notes };
}
