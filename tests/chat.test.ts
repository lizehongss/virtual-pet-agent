import { chatWithPet } from "../src/agent/chat";
import type {
  ChatMessage,
  GenerateTextInput,
  LlmClient,
} from "../src/agent/llm-client";
import { createInitialPet } from "../src/domain/pet";

class FakeLlmClient implements LlmClient {
  public readonly calls: GenerateTextInput[] = [];

  constructor(private readonly response: string | Error) {}

  async generateText(input: GenerateTextInput): Promise<string> {
    this.calls.push(input);
    if (this.response instanceof Error) {
      throw this.response;
    }
    return this.response;
  }
}

describe("pet chat", () => {
  it("sends the current pet state and user message to the LLM", async () => {
    const pet = createInitialPet("Mochi", new Date("2026-01-01T00:00:00Z"));
    const client = new FakeLlmClient("我今天感觉不错！");
    const history: ChatMessage[] = [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好呀！" },
    ];

    const result = await chatWithPet(pet, "你饿吗？", client, history);

    expect(result).toEqual({ ok: true, reply: "我今天感觉不错！" });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].system).toContain("饥饿度：30/100");
    expect(client.calls[0].messages).toEqual([
      ...history,
      { role: "user", content: "你饿吗？" },
    ]);
  });

  it("keeps only recent history before sending a message", async () => {
    const pet = createInitialPet();
    const client = new FakeLlmClient("好的");
    const history: ChatMessage[] = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index}`,
    }));

    await chatWithPet(pet, "最后一条", client, history);

    expect(client.calls[0].messages).toHaveLength(11);
    expect(client.calls[0].messages[0].content).toBe("message-2");
    expect(client.calls[0].messages.at(-1)?.content).toBe("最后一条");
  });

  it("returns a safe fallback when the LLM fails", async () => {
    const pet = createInitialPet();
    const client = new FakeLlmClient(new Error("network unavailable"));

    const result = await chatWithPet(pet, "陪我说说话", client);

    expect(result.ok).toBe(false);
    expect(result.reply).toContain("走神");
    if (result.ok) return;

    expect(result.error).toBe("network unavailable");
  });

  it("does not call the LLM for an empty message", async () => {
    const pet = createInitialPet();
    const client = new FakeLlmClient("不会被调用");

    const result = await chatWithPet(pet, "   ", client);

    expect(result.ok).toBe(false);
    expect(client.calls).toHaveLength(0);
  });
});
