import { z } from "zod";
import {
  DEFAULT_LLM_CONFIG_PATH,
  loadLlmConfig,
} from "../config/llm-config";
import type { LlmConfig } from "../config/llm-config";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type GenerateTextInput = {
  system: string;
  messages: ChatMessage[];
};

export interface LlmClient {
  generateText(input: GenerateTextInput): Promise<string>;
}

export type LlmClientConfig = LlmConfig;

const completionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

export class OpenAICompatibleLlmClient implements LlmClient {
  private readonly config: Required<LlmClientConfig>;

  constructor(config: LlmClientConfig) {
    this.config = config;
  }

  async generateText(input: GenerateTextInput): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.timeoutMs,
    );

    try {
      const response = await fetch(
        `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              { role: "system", content: input.system },
              ...input.messages,
            ],
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`LLM request failed with HTTP ${response.status}`);
      }

      const payload = completionResponseSchema.parse(await response.json());
      const content = payload.choices[0].message.content.trim();

      if (!content) {
        throw new Error("LLM returned an empty response");
      }

      return content;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class UnavailableLlmClient implements LlmClient {
  constructor(private readonly reason: string) {}

  async generateText(_input: GenerateTextInput): Promise<string> {
    throw new Error(this.reason);
  }
}

export async function createLlmClientFromConfigFile(
  filePath = DEFAULT_LLM_CONFIG_PATH,
): Promise<LlmClient> {
  const config = await loadLlmConfig(filePath);

  if (!config) {
    return new UnavailableLlmClient(
      `LLM config not found: ${filePath}. Copy config/llm.example.json to config/llm.local.json and fill in apiKey.`,
    );
  }

  return new OpenAICompatibleLlmClient(config);
}
