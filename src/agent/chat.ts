import type { PetState } from "../domain/pet";
import type { ChatMessage, LlmClient } from "./llm-client";
import { buildPetSystemPrompt } from "./prompts";

const MAX_HISTORY_MESSAGES = 10;

export type ChatResult =
  | {
      ok: true;
      reply: string;
    }
  | {
      ok: false;
      reply: string;
      error: string;
    };

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown LLM error";
}

export async function chatWithPet(
  pet: PetState,
  userMessage: string,
  llmClient: LlmClient,
  history: ChatMessage[] = [],
): Promise<ChatResult> {
  const content = userMessage.trim();

  if (!content) {
    return {
      ok: false,
      reply: "你想和我聊些什么呢？",
      error: "EMPTY_MESSAGE",
    };
  }

  const messages: ChatMessage[] = [
    ...history.slice(-MAX_HISTORY_MESSAGES),
    { role: "user", content },
  ];

  try {
    const reply = (await llmClient.generateText({
      system: buildPetSystemPrompt(pet),
      messages,
    })).trim();

    if (!reply) {
      throw new Error("LLM returned an empty response");
    }

    return { ok: true, reply };
  } catch (error) {
    return {
      ok: false,
      reply: "我现在有点走神，等会儿再和我聊天吧。",
      error: getErrorMessage(error),
    };
  }
}
