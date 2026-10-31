// Configuration and the live Gemini client for the expiry engine's AI
// fallback (ai-fallback.ts). The engine never imports this file's
// client directly: it takes an AiClient, so tests pass a mock and no
// test needs the network.
//
// Uses the server's existing Gemini client and error mapping
// (server/src/food/gemini.ts), so the API key is read in one place and
// only on the server. Nothing here is reachable from the Vite build:
// no VITE_ variable is read, and src/ never imports expiry-tests/.

import { Type, type Schema } from "@google/genai";
import { getClient, toGeminiError } from "../server/src/food/gemini.js";

// Bump when a prompt or schema changes, so cached answers from the old
// prompt are not reused.
export const PROMPT_VERSION = "expiry-ai-2";

export const DEFAULT_EXPIRY_MODEL = "gemini-flash-lite-latest";

export type AiMode = "tie_break" | "query_expansion";

// "minimal"   thinkingLevel MINIMAL (Gemini 3 style)
// "budget0"   thinkingBudget 0 (Gemini 2.5 style)
// "default"   no thinking setting; the model decides
// The API rejects a setting a model does not support with a 400, so
// this is configured, not guessed. test-hybrid.ts --probe finds the
// one the configured model accepts.
export type ThinkingMode = "minimal" | "budget0" | "default";

export type AiConfig = {
  // The whole fallback. False without an API key, whatever the flags say.
  enabled: boolean;
  tieBreak: boolean;
  // Off by default outside development.
  expansion: boolean;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  // undefined leaves the model default. The image endpoint found that
  // a low temperature can make Gemini 3 models loop, so it is opt-in.
  temperature: number | undefined;
  thinking: ThinkingMode;
};

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function number(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return value !== undefined && value.trim() !== "" && Number.isFinite(parsed) ? parsed : fallback;
}

// Environment variables (all optional except the key):
//   GEMINI_API_KEY                 shared with the image endpoint
//   EXPIRY_AI_MODEL                model for this fallback; falls back
//                                  to GEMINI_MODEL, then the default
//   EXPIRY_AI_FALLBACK_ENABLED     master switch, default on with a key
//   EXPIRY_AI_TIE_BREAK_ENABLED    default on
//   EXPIRY_AI_EXPANSION_ENABLED    default on in development only
//   EXPIRY_AI_TIMEOUT_MS           default 1500
//   EXPIRY_AI_MAX_OUTPUT_TOKENS    default 256
//   EXPIRY_AI_TEMPERATURE          default unset (model default)
//   EXPIRY_AI_THINKING             minimal | budget0 | default
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const hasKey = Boolean(env.GEMINI_API_KEY?.trim());
  const production = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  const enabled = hasKey && flag(env.EXPIRY_AI_FALLBACK_ENABLED, true);
  const thinking = env.EXPIRY_AI_THINKING?.trim();

  return {
    enabled,
    tieBreak: enabled && flag(env.EXPIRY_AI_TIE_BREAK_ENABLED, true),
    expansion: enabled && flag(env.EXPIRY_AI_EXPANSION_ENABLED, !production),
    model: env.EXPIRY_AI_MODEL?.trim() || env.GEMINI_MODEL?.trim() || DEFAULT_EXPIRY_MODEL,
    timeoutMs: number(env.EXPIRY_AI_TIMEOUT_MS, 1500),
    maxOutputTokens: number(env.EXPIRY_AI_MAX_OUTPUT_TOKENS, 256),
    temperature: env.EXPIRY_AI_TEMPERATURE ? number(env.EXPIRY_AI_TEMPERATURE, 0) : undefined,
    thinking: thinking === "minimal" || thinking === "budget0" ? thinking : "default",
  };
}

export type AiUsage = { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };

export type AiRequest = { mode: AiMode; prompt: string; schema: Schema };

export type AiResponse = { text: string | undefined; usage: AiUsage };

// One request, one answer. Throws on timeout or API error. The engine
// catches it and returns no suggestion; it never calls again.
export type AiClient = (request: AiRequest) => Promise<AiResponse>;

export const TIE_BREAK_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    selectedId: { type: Type.INTEGER, nullable: true },
    reason: { type: Type.STRING },
  },
  required: ["selectedId", "reason"],
  propertyOrdering: ["selectedId", "reason"],
};

export const EXPANSION_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    alternativeNames: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: "2", maxItems: "2" },
    alternativeCategories: { type: Type.ARRAY, items: { type: Type.STRING }, minItems: "2", maxItems: "2" },
  },
  required: ["alternativeNames", "alternativeCategories"],
  propertyOrdering: ["alternativeNames", "alternativeCategories"],
};

function thinkingConfig(mode: ThinkingMode) {
  if (mode === "minimal") return { thinkingConfig: { thinkingLevel: "MINIMAL" as never } };
  if (mode === "budget0") return { thinkingConfig: { thinkingBudget: 0 } };
  return {};
}

// The live client. Aborts after config.timeoutMs; never retries.
export function createGeminiClient(config: AiConfig): AiClient {
  return async (request) => {
    const ai = getClient();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), config.timeoutMs);

    try {
      const response = await ai.models.generateContent({
        model: config.model,
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: request.schema,
          maxOutputTokens: config.maxOutputTokens,
          ...(config.temperature === undefined ? {} : { temperature: config.temperature }),
          ...thinkingConfig(config.thinking),
          abortSignal: abort.signal,
        },
      });

      const usage = response.usageMetadata;
      return {
        text: response.text,
        usage: {
          inputTokens: usage?.promptTokenCount ?? null,
          outputTokens: usage?.candidatesTokenCount ?? null,
          totalTokens: usage?.totalTokenCount ?? null,
        },
      };
    } catch (err) {
      throw toGeminiError(err, abort.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
  };
}
