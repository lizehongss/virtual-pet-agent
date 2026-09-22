import type { PetState } from "../domain/pet";
import type { ChatMessage, LlmClient } from "./llm-client";
import { buildPetSystemPrompt } from "./prompts";
import type { PetMemory } from "../memory/memory-repository";
import { getRecentMessages } from "../memory/short-term-memory";

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
  memories: PetMemory[] = [],
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
    ...getRecentMessages(history),
    { role: "user", content },
  ];

  try {
    const reply = (await llmClient.generateText({
      system: buildPetSystemPrompt(pet, { memories }),
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
