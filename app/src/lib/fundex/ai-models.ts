// AI Gateway model slugs — verified 2026-04-14 via https://ai-gateway.vercel.sh/v1/models.
// Bumping versions: update the string here; gateway handles provider routing.
export const MODEL_HAIKU = "anthropic/claude-haiku-4.5";

export const GATEWAY_FALLBACK_ORDER = ["anthropic", "bedrock"] as const;
