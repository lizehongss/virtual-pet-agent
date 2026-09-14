import { runAgentTurn } from "../src/agent/agent-turn";
import type {
  ChatMessage,
  GenerateTextInput,
  GenerateWithToolsInput,
  GenerateWithToolsResult,
  ToolCallingLlmClient,
} from "../src/agent/llm-client";
import { createInitialPet } from "../src/domain/pet";
import { PetToolRegistry } from "../src/agent/tools";

class FakeToolCallingClient implements ToolCallingLlmClient {
  public readonly textCalls: GenerateTextInput[] = [];

  public readonly toolCalls: GenerateWithToolsInput[] = [];

  constructor(private readonly result: GenerateWithToolsResult) {}

  async generateText(input: GenerateTextInput): Promise<string> {
    this.textCalls.push(input);
    return "不会走这个方法";
  }

  async generateWithTools(
    input: GenerateWithToolsInput,
  ): Promise<GenerateWithToolsResult> {
    this.toolCalls.push(input);
    return this.result;
  }
}

describe("agent tool turn", () => {
  it("executes one model-selected tool and returns the updated state", async () => {
    const pet = createInitialPet("Mochi");
    const client = new FakeToolCallingClient({
      content: null,
      toolCalls: [
        {
          id: "call-1",
          name: "feed_pet",
          arguments: JSON.stringify({ amount: 20 }),
        },
      ],
    });

    const result = await runAgentTurn(
      pet,
      "我想喂你",
      client,
      new PetToolRegistry(),
    );

    expect(result.ok).toBe(true);
    expect(result.toolName).toBe("feed_pet");
    expect(result.event?.type).toBe("feed");
    expect(result.state.hunger).toBe(10);
    expect(client.toolCalls[0].tools).toHaveLength(5);
  });

  it("returns a normal reply when the model does not call a tool", async () => {
    const client = new FakeToolCallingClient({
      content: "你好呀！",
      toolCalls: [],
    });

    const result = await runAgentTurn(
      createInitialPet("Mochi"),
      "你好",
      client,
      new PetToolRegistry(),
      [{ role: "user", content: "之前的消息" }] as ChatMessage[],
    );

    expect(result).toMatchObject({
      ok: true,
      reply: "你好呀！",
      toolName: null,
    });
  });

  it("rejects malformed tool arguments without executing an action", async () => {
    const pet = createInitialPet("Mochi");
    const client = new FakeToolCallingClient({
      content: null,
      toolCalls: [
        {
          id: "call-1",
          name: "feed_pet",
          arguments: "not-json",
        },
      ],
    });

    const result = await runAgentTurn(
      pet,
      "喂我",
      client,
      new PetToolRegistry(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("INVALID_TOOL_ARGUMENTS_JSON");
    expect(result.state.hunger).toBe(pet.hunger);
  });

  it("does not execute multiple tool calls in one M4 turn", async () => {
    const pet = createInitialPet("Mochi");
    const client = new FakeToolCallingClient({
      content: null,
      toolCalls: [
        { id: "call-1", name: "feed_pet", arguments: '{"amount": 20}' },
        { id: "call-2", name: "pet_the_pet", arguments: "{}" },
      ],
    });

    const result = await runAgentTurn(
      pet,
      "照顾一下自己",
      client,
      new PetToolRegistry(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("MULTIPLE_TOOL_CALLS_NOT_SUPPORTED");
    expect(result.state).toEqual(expect.objectContaining({
      hunger: pet.hunger,
      mood: pet.mood,
    }));
  });
});
