import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
export const DEFAULT_LLM_CONFIG_PATH = resolve(
  process.cwd(),
  "config",
  "llm.local.json",
);

const llmConfigSchema = z
  .object({
    apiKey: z.string().trim().min(1),
    baseUrl: z.string().url().default(DEFAULT_DEEPSEEK_BASE_URL),
    model: z.string().trim().min(1).default(DEFAULT_DEEPSEEK_MODEL),
    timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  })
  .strict();

export type LlmConfig = z.infer<typeof llmConfigSchema>;

export async function loadLlmConfig(
  filePath = DEFAULT_LLM_CONFIG_PATH,
): Promise<LlmConfig | null> {
  let raw: string;

  try {
    raw = await readFile(resolve(filePath), "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`LLM config is not valid JSON: ${filePath}`);
  }

  const result = llmConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
      .join("; ");
    throw new Error(`LLM config is invalid: ${details}`);
  }

  return result.data;
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
