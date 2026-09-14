import { z } from "zod";
import {
  DEFAULT_LLM_CONFIG_PATH,
  loadLlmConfig,
} from "../config/llm-config";
import type { LlmConfig } from "../config/llm-config";
import { devLog } from "./debug";

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type GenerateTextInput = {
  system: string;
  messages: ChatMessage[];
};

export type LlmToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type GenerateWithToolsInput = GenerateTextInput & {
  tools: LlmToolDefinition[];
};

export type GenerateWithToolsResult = {
  content: string | null;
  toolCalls: ToolCall[];
};

export interface LlmClient {
  generateText(input: GenerateTextInput): Promise<string>;
}

export interface ToolCallingLlmClient extends LlmClient {
  generateWithTools(
    input: GenerateWithToolsInput,
  ): Promise<GenerateWithToolsResult>;
}

export type LlmClientConfig = LlmConfig & {
  debug?: boolean;
};

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

const toolCompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({
                  name: z.string(),
                  arguments: z.string(),
                }),
              }),
            )
            .optional(),
        }),
      }),
    )
    .min(1),
});

export class OpenAICompatibleLlmClient implements ToolCallingLlmClient {
  private readonly config: Required<LlmClientConfig>;

  constructor(config: LlmClientConfig) {
    this.config = {
      debug: false,
      ...config,
    };
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

      devLog("llm", "model text response", { content }, this.config.debug);
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  async generateWithTools(
    input: GenerateWithToolsInput,
  ): Promise<GenerateWithToolsResult> {
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
            tools: input.tools,
            tool_choice: "auto",
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw new Error(`LLM tool request failed with HTTP ${response.status}`);
      }

      const payload = toolCompletionResponseSchema.parse(await response.json());
      const message = payload.choices[0].message;

      const result = {
        content: message.content ?? null,
        toolCalls: (message.tool_calls ?? []).map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        })),
      };

      devLog("llm", "model tool response", result, this.config.debug);
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class UnavailableLlmClient implements ToolCallingLlmClient {
  constructor(private readonly reason: string) {}

  async generateText(_input: GenerateTextInput): Promise<string> {
    throw new Error(this.reason);
  }

  async generateWithTools(
    _input: GenerateWithToolsInput,
  ): Promise<GenerateWithToolsResult> {
    throw new Error(this.reason);
  }
}

export async function createLlmClientFromConfigFile(
  filePath = DEFAULT_LLM_CONFIG_PATH,
  options: { debug?: boolean } = {},
): Promise<ToolCallingLlmClient> {
  const config = await loadLlmConfig(filePath);

  if (!config) {
    return new UnavailableLlmClient(
      `LLM config not found: ${filePath}. Copy config/llm.example.json to config/llm.local.json and fill in apiKey.`,
    );
  }

  return new OpenAICompatibleLlmClient({
    ...config,
    debug: options.debug ?? false,
  });
}
