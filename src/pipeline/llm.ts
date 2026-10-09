/**
 * Minimal client for an OpenAI-compatible local server (LM Studio by default).
 * Env: DIAGRAM_MCP_LLM_URL (default http://127.0.0.1:1234/v1), DIAGRAM_MCP_LLM_MODEL (default: first non-embedding model),
 *      DIAGRAM_MCP_LLM_TIMEOUT_MS (per call, default 240000), DIAGRAM_MCP_LLM_API_KEY (optional).
 */
import { z } from "zod";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "timeout" | "bad_output" | "http" = "http",
  ) {
    super(message);
  }
}

export interface JsonCall<T> {
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface Llm {
  readonly label: string;
  json<T>(call: JsonCall<T>): Promise<{ value: T; ms: number }>;
}

const BASE = () => (process.env.DIAGRAM_MCP_LLM_URL ?? "http://127.0.0.1:1234/v1").replace(/\/$/, "");
const TIMEOUT = () => Number(process.env.DIAGRAM_MCP_LLM_TIMEOUT_MS ?? 240_000);

const headers = () => ({
  "Content-Type": "application/json",
  ...(process.env.DIAGRAM_MCP_LLM_API_KEY ? { Authorization: `Bearer ${process.env.DIAGRAM_MCP_LLM_API_KEY}` } : {}),
});

let modelCache: string | undefined;
async function pickModel(): Promise<string> {
  if (process.env.DIAGRAM_MCP_LLM_MODEL) return process.env.DIAGRAM_MCP_LLM_MODEL;
  if (modelCache) return modelCache;
  let res: Response;
  try {
    res = await fetch(`${BASE()}/models`, { headers: headers(), signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new LlmError(
      `LLM server not reachable at ${BASE()} (${(e as Error).message}). Start LM Studio's local server or set DIAGRAM_MCP_LLM_URL.`,
      "unavailable",
    );
  }
  if (!res.ok) throw new LlmError(`LLM server answered ${res.status} for /models at ${BASE()}`, "http");
  const { data } = (await res.json()) as { data: { id: string }[] };
  const m = data.find((d) => !/embed/i.test(d.id));
  if (!m)
    throw new LlmError(
      `No chat model loaded at ${BASE()}. Load one in LM Studio or set DIAGRAM_MCP_LLM_MODEL.`,
      "unavailable",
    );
  return (modelCache = m.id);
}

/** Reasoning models may leave `content` empty and put the answer in `reasoning_content`, or wrap it in <think>. */
function extractJson(msg: { content?: string | null; reasoning_content?: string | null }): unknown {
  const raw = (msg.content?.trim() || msg.reasoning_content?.trim() || "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();
  if (!raw) throw new Error("empty reply");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1] ?? raw;
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(fenced.slice(start, end + 1));
}

let structuredOutput = true;

export function lmStudio(): Llm {
  return {
    label: `${BASE()}`,
    async json<T>(call: JsonCall<T>) {
      const model = await pickModel();
      const jsonSchema = z.toJSONSchema(call.schema) as Record<string, unknown>;
      delete jsonSchema.$schema;
      let user = `${call.user}\n\n/no_think`;
      let lastErr = "";
      for (let attempt = 0; attempt < 2; attempt++) {
        const t0 = Date.now();
        const body = {
          model,
          temperature: 0.2,
          max_tokens: call.maxTokens ?? 6000,
          messages: [
            { role: "system", content: call.system },
            { role: "user", content: user },
          ],
          ...(structuredOutput
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: { name: call.name, strict: true, schema: jsonSchema },
                },
              }
            : {}),
        };
        let res: Response;
        try {
          res = await fetch(`${BASE()}/chat/completions`, {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT()),
          });
        } catch (e) {
          const err = e as Error;
          if (err.name === "TimeoutError" || err.name === "AbortError")
            throw new LlmError(
              `LLM call '${call.name}' timed out after ${TIMEOUT()}ms (raise DIAGRAM_MCP_LLM_TIMEOUT_MS)`,
              "timeout",
            );
          throw new LlmError(`LLM server not reachable at ${BASE()} (${err.message})`, "unavailable");
        }
        if (!res.ok) {
          const text = await res.text();
          if (res.status === 400 && structuredOutput && /response_format|json_schema/i.test(text)) {
            structuredOutput = false; // server can't constrain output: rely on the prompt and our own parsing
            attempt--;
            continue;
          }
          throw new LlmError(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`, "http");
        }
        const data = (await res.json()) as {
          choices?: { message: { content?: string; reasoning_content?: string } }[];
        };
        try {
          const value = call.schema.parse(extractJson(data.choices?.[0]?.message ?? {}));
          return { value, ms: Date.now() - t0 };
        } catch (e) {
          lastErr =
            e instanceof z.ZodError
              ? e.issues
                  .slice(0, 5)
                  .map((i) => `${i.path.join(".")}: ${i.message}`)
                  .join("; ")
              : (e as Error).message;
          user = `${call.user}\n\nYour previous reply was invalid (${lastErr}). Reply with one valid JSON object only.\n\n/no_think`;
        }
      }
      throw new LlmError(`LLM output for '${call.name}' was not valid after retry: ${lastErr}`, "bad_output");
    },
  };
}
