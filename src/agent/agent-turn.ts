import { randomUUID } from "node:crypto";
import type { PetEvent, PetState } from "../domain/pet";
import type {
  AssistantToolCallMessage,
  ChatMessage,
  LlmMessage,
  ToolCallingLlmClient,
  ToolResultMessage,
} from "./llm-client";
import { buildPetSystemPrompt } from "./prompts";
import { PetToolRegistry } from "./tools";
import type { ToolExecutionResult } from "./tools";
import { advanceTime } from "../domain/pet";
import { devLog } from "./debug";
import type { PetMemory } from "../memory/memory-repository";
import { getRecentMessages } from "../memory/short-term-memory";

export const MAX_AGENT_STEPS = 3;

export type AgentTurnResult = {
  requestId: string;
  ok: boolean;
  reply: string;
  state: PetState;
  toolName: string | null;
  event?: PetEvent;
  events: PetEvent[];
  error?: string;
};

export async function runAgentTurn(
  pet: PetState,
  userMessage: string,
  llmClient: ToolCallingLlmClient,
  toolRegistry: PetToolRegistry,
  history: ChatMessage[] = [],
  options: { debug?: boolean; memories?: PetMemory[] } = {},
): Promise<AgentTurnResult> {
  const requestId = randomUUID();
  const content = userMessage.trim();
  const now = new Date();
  let currentPet = advanceTime(pet, now);
  const events: PetEvent[] = [];
  let lastToolName: string | null = null;
  let hasToolFailure = false;
  let lastToolError: string | undefined;

  if (!content) {
    return {
      requestId,
      ok: false,
      reply: "你想让我做些什么呢？",
      state: currentPet,
      toolName: null,
      events,
      error: "EMPTY_MESSAGE",
    };
  }

  const messages: LlmMessage[] = [
    ...getRecentMessages(history),
    { role: "user", content },
  ];

  try {
    for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
      const decision = await llmClient.generateWithTools({
        system: buildPetSystemPrompt(currentPet, {
          allowTools: true,
          memories: options.memories,
        }),
        messages,
        tools: toolRegistry.getDefinitions(),
      });

      devLog(
        "agent",
        "model decision",
        {
          requestId,
          step: step + 1,
          content: decision.content,
          toolCalls: decision.toolCalls,
        },
        options.debug ?? false,
      );

      if (decision.toolCalls.length === 0) {
        const reply = decision.content?.trim();
        if (!reply) {
          return {
            requestId,
            ok: false,
            reply: "我暂时不知道该怎么回答，我们换个话题吧。",
            state: currentPet,
            toolName: lastToolName,
            event: events.at(-1),
            events,
            error: "EMPTY_AGENT_RESPONSE",
          };
        }

        return {
          requestId,
          ok: !hasToolFailure,
          reply,
          state: currentPet,
          toolName: lastToolName,
          event: events.at(-1),
          events,
          error: hasToolFailure
            ? lastToolError ?? "TOOL_EXECUTION_FAILED"
            : undefined,
        };
      }

      const assistantMessage: AssistantToolCallMessage = {
        role: "assistant",
        content: decision.content,
        tool_calls: decision.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function" as const,
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        })),
      };
      messages.push(assistantMessage);

      for (const toolCall of decision.toolCalls) {
        lastToolName = toolCall.name;
        let execution: ToolExecutionResult;

        try {
          const toolArguments = JSON.parse(toolCall.arguments || "{}");
          execution = await toolRegistry.execute(toolCall.name, toolArguments, {
            pet: currentPet,
            now,
          });
        } catch (error) {
          execution = {
            ok: false,
            state: currentPet,
            toolName: null,
            message: "我没有正确理解这个动作的参数，请再说一次。",
            error:
              error instanceof SyntaxError
                ? "INVALID_TOOL_ARGUMENTS_JSON"
                : error instanceof Error
                  ? error.message
                  : "TOOL_EXECUTION_FAILED",
          };
        }

        currentPet = execution.state;
        if (execution.event) {
          events.push(execution.event);
        }
        if (!execution.ok) {
          hasToolFailure = true;
          lastToolError = execution.error;
        }

        devLog(
          "tool",
          "tool execution result",
          {
            requestId,
            toolName: toolCall.name,
            ok: execution.ok,
            message: execution.message,
            error: execution.error,
            event: execution.event,
          },
          options.debug ?? false,
        );

        const toolResultMessage: ToolResultMessage = {
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({
            ok: execution.ok,
            message: execution.message,
            error: execution.error ?? null,
            state: execution.state,
            event: execution.event ?? null,
          }),
        };
        messages.push(toolResultMessage);
      }
    }

    return {
      requestId,
      ok: false,
      reply: "我已经处理了几步，但还没有得到明确结果。请换一种说法再试一次。",
      state: currentPet,
      toolName: lastToolName,
      event: events.at(-1),
      events,
      error: "MAX_AGENT_STEPS_EXCEEDED",
    };
  } catch (error) {
    return {
      requestId,
      ok: false,
      reply: "我现在有点走神，等会儿再和我聊天吧。",
      state: currentPet,
      toolName: lastToolName,
      event: events.at(-1),
      events,
      error: error instanceof Error ? error.message : "Unknown agent error",
    };
  }
}
