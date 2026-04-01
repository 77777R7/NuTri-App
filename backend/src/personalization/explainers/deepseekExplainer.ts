import type {
  ExplanationPayload,
  ExplanationResult,
} from "../../../../types/personalization.js";
import {
  renderDeterministicExplanation,
  personalizationAiInternals,
  type PersonalizationExplainer,
} from "../ai.js";

type DeepSeekChatMessage = {
  role: "system" | "user";
  content: string;
};

type DeepSeekTransport = (input: {
  apiKey: string;
  model: string;
  messages: DeepSeekChatMessage[];
  timeoutMs: number;
}) => Promise<string>;

type CreateDeepSeekExplainerOptions = {
  apiKey?: string | null;
  model?: string;
  timeoutMs?: number;
  transport?: DeepSeekTransport;
};

type ParsedExplanationResponse = {
  summary?: string;
  bullets?: unknown;
};

const DEFAULT_TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = [
  "You are NuTri's personalization explainer.",
  "Use only the structured facts provided.",
  "Do not introduce new recommendations, dosing guidance, disease claims, or deficiency claims.",
  "For plan_preview, prioritize which ingredient directions NuTri will review for the user's selected goals when ingredient-lane facts are present.",
  "If the user has multiple selected goals for plan_preview, do not silently drop them; mention every selected goal explicitly in the summary or bullets.",
  "Phrase ingredient guidance as 'we will review' or 'we will look at', not as instructions to take a supplement.",
  "Avoid generic summaries that only restate selected goals and supplement types.",
  "Return JSON only with keys: summary, bullets.",
  "summary must be one sentence.",
  "For plan_preview, bullets should scale with the selected goals: if there are N goal ingredient lanes, return N short bullets so every selected goal is covered.",
  "For other surfaces, bullets must be an array of 2 to 4 short strings.",
].join(" ");

const truncate = (value: string, max = 1200): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const extractJsonCandidate = (content: string): string | null => {
  const raw = content.trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : raw).trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return candidate.slice(first, last + 1);
  }

  return null;
};

const parseResponse = (content: string): ParsedExplanationResponse | null => {
  const candidate = extractJsonCandidate(content);
  if (!candidate) return null;

  try {
    return JSON.parse(candidate) as ParsedExplanationResponse;
  } catch {
    return null;
  }
};

const sanitizeBullets = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
};

const buildMessages = (payload: ExplanationPayload): DeepSeekChatMessage[] => [
  { role: "system", content: SYSTEM_PROMPT },
  {
    role: "user",
    content: JSON.stringify(
      {
        task: "Explain NuTri personalization for one surface using only these structured facts.",
        contract: {
          allowedSurfaces: [
            "plan_preview",
            "first_stack",
            "goal_fit_detail",
            "product_compare",
            "weekly_insight",
          ],
          mustNotAdd: [
            "new recommendations",
            "dosing guidance",
            "disease claims",
            "deficiency claims",
          ],
        },
        payload,
      },
      null,
      2,
    ),
  },
];

const defaultTransport: DeepSeekTransport = async ({ apiKey, model, messages, timeoutMs }) => {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages,
    }),
    signal: timeout,
  });

  if (!response.ok) {
    throw new Error(`DeepSeek personalization explainer failed with ${response.status}`);
  }

  const json = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  return String(json.choices?.[0]?.message?.content ?? "");
};

export const createDeepSeekPersonalizationExplainer = (
  options: CreateDeepSeekExplainerOptions = {},
): PersonalizationExplainer => {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? null;
  const model = options.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const transport = options.transport ?? defaultTransport;

  return {
    async explain(input: ExplanationPayload): Promise<ExplanationResult> {
      if (!apiKey || input.facts.length === 0) {
        return renderDeterministicExplanation(input);
      }

      try {
        const raw = await transport({
          apiKey,
          model,
          messages: buildMessages(input),
          timeoutMs,
        });

        const parsed = parseResponse(raw);
        const summary = parsed?.summary?.trim();
        const bullets = sanitizeBullets(parsed?.bullets);
        const deterministic = renderDeterministicExplanation(input);
        const ingredientLaneCount =
          input.surface === "plan_preview"
            ? personalizationAiInternals.buildGoalIngredientLanes(input.selectedGoals).length
            : 0;
        const normalizedBullets =
          input.surface === "plan_preview" && ingredientLaneCount > 0 && bullets.length < ingredientLaneCount
            ? deterministic.bullets
            : bullets;

        if (!summary || normalizedBullets.length === 0) {
          return {
            ...deterministic,
            model,
          };
        }

        return {
          source: "deepseek",
          fallback: false,
          summary,
          bullets: normalizedBullets,
          model,
        };
      } catch {
        const fallback = renderDeterministicExplanation(input);
        return {
          ...fallback,
          model,
          summary: fallback.summary,
          bullets: fallback.bullets,
        };
      }
    },
  };
};

export const deepSeekPersonalizationExplainerInternals = {
  buildMessages,
  parseResponse,
  sanitizeBullets,
  truncate,
};
