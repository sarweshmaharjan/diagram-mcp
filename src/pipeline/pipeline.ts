/** request -> interpret -> (review -> fix)* -> final spec. */
import { refine, type Iteration, type StopReason } from "./critic.js";
import { interpret, type Plan } from "./interpret.js";
import type { Llm } from "./llm.js";
import { validate, type Spec } from "../core/model.js";
import { understand } from "../core/understand.js";

export interface DrawResult {
  spec: Spec;
  plan: Plan;
  iterations: Iteration[];
  stopped: StopReason;
  notes: string[];
  dropped: string[];
  interpret_ms: number;
}

export async function draw(opts: {
  llm: Llm;
  request: string;
  existing?: Spec;
  provider?: "aws" | "gcp" | "azure";
  direction?: "LR" | "TB";
  maxIterations?: number;
  onProgress?: (i: number, total: number, msg: string) => void;
}): Promise<DrawResult> {
  opts.onProgress?.(0, 6, "Interpreting the request");
  const interp = await interpret(opts.llm, {
    request: opts.request,
    existing: opts.existing,
    provider: opts.provider,
    direction: opts.direction,
  });
  const loop = await refine({
    llm: opts.llm,
    request: opts.request,
    spec: interp.spec,
    maxIterations: opts.maxIterations,
    onProgress: opts.onProgress,
  });
  const spec = understand(loop.spec).spec;
  validate(spec); // never hand an unrenderable spec to the renderer
  return {
    spec,
    plan: interp.plan,
    iterations: loop.iterations,
    stopped: loop.stopped,
    notes: loop.notes,
    dropped: interp.dropped,
    interpret_ms: interp.ms,
  };
}

const STOP_TEXT: Record<StopReason, string> = {
  approved: "approved by the reviewer",
  max_iterations: "stopped at the iteration limit",
  no_progress: "stopped: further passes would change nothing",
  regressed: "stopped: a revision scored worse, kept the best version",
  llm_error: "stopped: the LLM failed, kept the best version so far",
};

export function summarize(r: DrawResult, max: number): string {
  const lines = [
    `Interpreted as ${r.plan.diagram_type}, direction ${r.plan.direction} (${r.plan.direction_reason}).`,
    `Review loop: ${r.iterations.length} of max ${max} passes, ${STOP_TEXT[r.stopped]}.`,
    ...r.iterations.map((i) => `  pass ${i.n}: score ${i.score}/10, ${i.findings.length} finding(s) -> ${i.action}`),
  ];
  const last = r.iterations.at(-1);
  const open = last?.findings.filter((f) => f.severity !== "minor") ?? [];
  if (r.stopped !== "approved" && open.length)
    lines.push("Unresolved:", ...open.map((f) => `  - [${f.severity}] ${f.problem}`));
  if (r.dropped.length) lines.push(`Icons the model invented and the server replaced: ${r.dropped.join("; ")}`);
  return lines.join("\n");
}
