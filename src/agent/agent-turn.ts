import type { PetEvent, PetState } from "../domain/pet";
import type {
  ChatMessage,
  ToolCallingLlmClient,
} from "./llm-client";
import { buildPetSystemPrompt } from "./prompts";
import { PetToolRegistry } from "./tools";
import { advanceTime } from "../domain/pet";

export type AgentTurnResult = {
  ok: boolean;
  reply: string;
  state: PetState;
  toolName: string | null;
  event?: PetEvent;
  error?: string;
};

export async function runAgentTurn(
  pet: PetState,
  userMessage: string,
  llmClient: ToolCallingLlmClient,
  toolRegistry: PetToolRegistry,
  history: ChatMessage[] = [],
): Promise<AgentTurnResult> {
  const content = userMessage.trim();
  const now = new Date();
  const currentPet = advanceTime(pet, now);

  if (!content) {
    return {
      ok: false,
      reply: "你想让我做些什么呢？",
      state: currentPet,
      toolName: null,
      error: "EMPTY_MESSAGE",
    };
  }

  const messages: ChatMessage[] = [
    ...history.slice(-10),
    { role: "user", content },
  ];

  try {
    const decision = await llmClient.generateWithTools({
      system: buildPetSystemPrompt(currentPet, { allowTools: true }),
      messages,
      tools: toolRegistry.getDefinitions(),
    });

    if (decision.toolCalls.length === 0) {
      const reply = decision.content?.trim();
      if (!reply) {
        return {
          ok: false,
          reply: "我暂时不知道该怎么回答，我们换个话题吧。",
          state: currentPet,
          toolName: null,
          error: "EMPTY_AGENT_RESPONSE",
        };
      }

      return {
        ok: true,
        reply,
        state: currentPet,
        toolName: null,
      };
    }

    if (decision.toolCalls.length > 1) {
      return {
        ok: false,
        reply: "我一次只能处理一个宠物动作，请你一件一件告诉我。",
        state: currentPet,
        toolName: null,
        error: "MULTIPLE_TOOL_CALLS_NOT_SUPPORTED",
      };
    }

    const toolCall = decision.toolCalls[0];
    let toolArguments: unknown;

    try {
      toolArguments = JSON.parse(toolCall.arguments || "{}");
    } catch {
      return {
        ok: false,
        reply: "我没有正确理解这个动作的参数，请再说一次。",
        state: currentPet,
        toolName: toolCall.name,
        error: "INVALID_TOOL_ARGUMENTS_JSON",
      };
    }

    const execution = await toolRegistry.execute(toolCall.name, toolArguments, {
      pet: currentPet,
      now,
    });

    return {
      ok: execution.ok,
      reply: execution.message,
      state: execution.state,
      toolName: toolCall.name,
      event: execution.event,
      error: execution.error,
    };
  } catch (error) {
    return {
      ok: false,
      reply: "我现在有点走神，等会儿再和我聊天吧。",
      state: currentPet,
      toolName: null,
      error: error instanceof Error ? error.message : "Unknown agent error",
    };
  }
}
