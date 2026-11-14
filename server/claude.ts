import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { config } from "./config.js";

/**
 * One place for talking to Claude. The API key is read from the
 * ANTHROPIC_API_KEY environment variable by the Anthropic library itself.
 */

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ maxRetries: 3, timeout: 5 * 60 * 1000 });
  return client;
}

/** A problem worth showing to the user in plain words. */
export class AiError extends Error {}

// US dollars per million tokens (input, output). Used only to show what a
// listing cost; the real bill is on your Anthropic account.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-2": { input: 8, output: 40 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

interface UsageNumbers {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export function costUsd(model: string, usage: UsageNumbers): number {
  const price = PRICES[model] ?? PRICES[config.model] ?? PRICES["claude-opus-5-5"];
  const input =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * price.input + usage.output_tokens * price.output) / 1_000_000;
}

export type ContentBlock = Anthropic.Beta.BetaContentBlockParam;

export function imageBlock(jpeg: Buffer): ContentBlock {
  return {
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
  };
}

export function textBlock(text: string): ContentBlock {
  return { type: "text", text };
}

export interface AiResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface AskOptions<S extends z.ZodType> {
  schema: S;
  system: string;
  content: ContentBlock[];
  maxTokens?: number;
}

/**
 * Ask Claude a question and get the answer back in a fixed shape.
 *
 * If Claude's safety filter declines a request (rare for second-hand goods),
 * `fallbacks: "default"` lets Anthropic retry it on another Claude model
 * inside the same call instead of failing.
 */
export async function askClaude<S extends z.ZodType>(opts: AskOptions<S>): Promise<AiResult<z.infer<S>>> {
  if (!config.hasAnthropicKey) {
    throw new AiError("The Anthropic API key is not set on the server yet (ANTHROPIC_API_KEY).");
  }
  const base = {
    model: config.model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    output_config: { effort: config.effort, format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user" as const, content: opts.content }],
  };

  let response;
  try {
    try {
      response = await getClient().beta.messages.parse({
        ...base,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
    } catch (err) {
      // If the optional retry-on-decline feature is not accepted for this
      // model or account, run the same request without it.
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      console.warn("[claude] request rejected with fallbacks enabled, retrying without:", err.message);
      response = await getClient().beta.messages.parse(base);
    }
  } catch (err) {
    throw explain(err);
  }

  if (response.stop_reason === "refusal") {
    throw new AiError("Claude declined to write about this item. Try different photos, or write this one by hand.");
  }
  if (response.stop_reason === "max_tokens" || !response.parsed_output) {
    throw new AiError("Claude's answer was cut off. Try again, or use fewer photos.");
  }

  const usage = response.usage;
  return {
    data: response.parsed_output as z.infer<S>,
    model: response.model,
    inputTokens: usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    costUsd: costUsd(response.model, usage),
  };
}

function explain(err: unknown): Error {
  if (err instanceof Anthropic.AuthenticationError) {
    return new AiError("The Anthropic API key was not accepted. Check ANTHROPIC_API_KEY on the server.");
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("This Anthropic account is not allowed to use the chosen Claude model.");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("Claude is busy or your account hit its rate limit. Wait a minute and try again.");
  }
  if (err instanceof Anthropic.BadRequestError) {
    const lowCredit = /credit balance/i.test(err.message);
    return new AiError(
      lowCredit
        ? "Your Anthropic account is out of credit. Add credit under Billing in the Anthropic Console."
        : `Claude could not process this request (${err.message}).`,
    );
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError("Could not reach Claude. Check the connection and try again.");
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError(`Claude had a problem (${err.status ?? "unknown"}). Try again in a moment.`);
  }
  return err instanceof Error ? err : new Error(String(err));
}
