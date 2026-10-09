// Stop-rule tests for the review loop, with a scripted fake LLM (no LM Studio needed).
import assert from "node:assert/strict";
import { refine, MAX_ITERATIONS, type Review } from "../src/pipeline/critic.js";
import { LlmError, type Llm } from "../src/pipeline/llm.js";
import type { Spec } from "../src/core/model.js";

const spec: Spec = {
  title: "t",
  nodes: [
    { id: "a", label: "A", icon: "aws:lambda" },
    { id: "b", label: "B", icon: "aws:dynamodb" },
  ],
  edges: [{ from: "a", to: "b" }],
  groups: [],
};

const ok = (score: number, extra: Partial<Review> = {}): Review => ({
  matches_request: true,
  score,
  issues: [],
  ops: {},
  ...extra,
});

function fake(script: (n: number) => Review | Error): { llm: Llm; calls: () => number } {
  let n = 0;
  return {
    calls: () => n,
    llm: {
      label: "fake",
      async json<T>() {
        const r = script(++n);
        if (r instanceof Error) throw r;
        return { value: r as unknown as T, ms: 1 };
      },
    },
  };
}

const run = (llm: Llm, max?: number) => refine({ llm, request: "a to b", spec, maxIterations: max });
const issue = (problem: string, severity: "blocker" | "major" | "minor" = "major") => ({ severity, problem });

// 1. good diagram: one review, approved
{
  const f = fake(() => ok(9));
  const r = await run(f.llm);
  assert.equal(r.stopped, "approved");
  assert.equal(r.iterations.length, 1);
  assert.equal(f.calls(), 1);
}

// 2. never satisfied, always proposes a *different* edit: must stop at exactly MAX_ITERATIONS reviews
{
  const f = fake((n) => ({
    matches_request: false,
    score: 3 + n * 0.1,
    issues: [issue(`problem ${n}`)],
    ops: { update_nodes: [{ id: "a", label: `A${n}` }] },
  }));
  const r = await run(f.llm, 99); // caller asks for 99: capped
  assert.equal(MAX_ITERATIONS, 5);
  assert.equal(r.stopped, "max_iterations");
  assert.equal(r.iterations.length, 5);
  assert.equal(f.calls(), 5);
  assert.equal(
    r.spec.nodes[0].label,
    "A4",
    "best (= last reviewed) version is returned, the unreviewed 5th edit is not applied",
  );
}

// 3. same issues twice: no_progress at pass 2
{
  const f = fake(() => ({
    matches_request: false,
    score: 5,
    issues: [issue("stuck")],
    ops: { update_nodes: [{ id: "a", label: "X" }] },
  }));
  const r = await run(f.llm);
  assert.equal(r.stopped, "no_progress");
  assert.equal(r.iterations.length, 2);
}

// 4. empty ops while not approved: nothing to change, stop
{
  const f = fake(() => ({ matches_request: false, score: 5, issues: [issue("meh")], ops: {} }));
  const r = await run(f.llm);
  assert.equal(r.stopped, "no_progress");
  assert.equal(r.iterations.length, 1);
}

// 5. revision makes it worse: revert to the best version
{
  const f = fake((n) =>
    n === 1
      ? {
          matches_request: false,
          score: 6,
          issues: [issue("fix me")],
          ops: { update_nodes: [{ id: "a", label: "Worse" }] },
        }
      : ok(2, { matches_request: false, issues: [issue("new problem")] }),
  );
  const r = await run(f.llm);
  assert.equal(r.stopped, "regressed");
  assert.equal(r.spec.nodes[0].label, "A", "original, higher-scoring version returned");
}

// 6. LLM dies mid-loop: keep best so far
{
  const f = fake((n) =>
    n === 1
      ? { matches_request: false, score: 6, issues: [issue("fix")], ops: { update_nodes: [{ id: "a", label: "A2" }] } }
      : new LlmError("down", "unavailable"),
  );
  const r = await run(f.llm);
  assert.equal(r.stopped, "llm_error");
  assert.equal(r.spec.nodes[0].label, "A", "last reviewed version, not the unreviewed edit");
}

// 7. invalid edits are rejected, loop stays bounded and survives
{
  const f = fake((n) => ({
    matches_request: false,
    score: 5,
    issues: [issue(`p${n}`)],
    ops: { remove_nodes: ["ghost"], add_edges: [{ from: "a", to: "nope" }] },
  }));
  const r = await run(f.llm);
  assert.ok(r.iterations.length <= 5);
  assert.ok(r.iterations.some((i) => i.action.startsWith("edits rejected")));
}

// 8. max_iterations=1 reviews once and never edits
{
  const f = fake(() => ({
    matches_request: false,
    score: 4,
    issues: [issue("x")],
    ops: { update_nodes: [{ id: "a", label: "Z" }] },
  }));
  const r = await run(f.llm, 1);
  assert.equal(r.iterations.length, 1);
  assert.equal(r.spec.nodes[0].label, "A");
}

console.log("loop tests passed (8)");
