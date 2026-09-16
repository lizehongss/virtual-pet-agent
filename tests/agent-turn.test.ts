import { runAgentTurn } from "../src/agent/agent-turn";
import type {
  GenerateTextInput,
  GenerateWithToolsInput,
  GenerateWithToolsResult,
  ToolCallingLlmClient,
} from "../src/agent/llm-client";
import { PetToolRegistry } from "../src/agent/tools";
import { createInitialPet } from "../src/domain/pet";

class FakeToolCallingClient implements ToolCallingLlmClient {
  public readonly textCalls: GenerateTextInput[] = [];

  public readonly toolCalls: GenerateWithToolsInput[] = [];

  private readonly results: GenerateWithToolsResult[];

  constructor(results: GenerateWithToolsResult[]) {
    this.results = [...results];
  }

  async generateText(input: GenerateTextInput): Promise<string> {
    this.textCalls.push(input);
    return "不会走这个方法";
  }

  async generateWithTools(
    input: GenerateWithToolsInput,
  ): Promise<GenerateWithToolsResult> {
    this.toolCalls.push(input);
    return (
      this.results.shift() ?? {
        content: "测试客户端没有更多响应了。",
        toolCalls: [],
      }
    );
  }
}

describe("agent loop", () => {
  it("executes a tool, sends its result back, and returns the model's final reply", async () => {
    const client = new FakeToolCallingClient([
      {
        content: null,
        toolCalls: [
          {
            id: "call-1",
            name: "feed_pet",
            arguments: JSON.stringify({ amount: 20 }),
          },
        ],
      },
      { content: "吃饱啦，谢谢你！", toolCalls: [] },
    ]);

    const result = await runAgentTurn(
      createInitialPet("Mochi"),
      "我想喂你",
      client,
      new PetToolRegistry(),
    );

    expect(result).toMatchObject({
      ok: true,
      reply: "吃饱啦，谢谢你！",
      toolName: "feed_pet",
      state: { hunger: 10 },
    });
    expect(result.events).toHaveLength(1);
    expect(result.event?.type).toBe("feed");
    expect(result.requestId).toEqual(expect.any(String));
    expect(client.toolCalls).toHaveLength(2);
    expect(client.toolCalls[0].tools).toHaveLength(5);
    expect(client.toolCalls[1].system).toContain("饥饿度：10/100");
    expect(client.toolCalls[1].messages).toEqual(
      expect.arrayContaining([
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "feed_pet",
                arguments: JSON.stringify({ amount: 20 }),
              },
            },
          ],
        },
        expect.objectContaining({
          role: "tool",
          tool_call_id: "call-1",
        }),
      ]),
    );

    const toolResult = client.toolCalls[1].messages.find(
      (message) => message.role === "tool",
    );
    expect(toolResult?.role).toBe("tool");
    if (toolResult?.role === "tool") {
      expect(JSON.parse(toolResult.content)).toMatchObject({
        ok: true,
        state: { hunger: 10 },
        event: { type: "feed" },
      });
    }
  });

  it("returns a normal reply when the model does not call a tool", async () => {
    const client = new FakeToolCallingClient([
      { content: "你好呀！", toolCalls: [] },
    ]);

    const result = await runAgentTurn(
      createInitialPet("Mochi"),
      "你好",
      client,
      new PetToolRegistry(),
    );

    expect(result).toMatchObject({
      ok: true,
      reply: "你好呀！",
      toolName: null,
      events: [],
    });
  });

  it("feeds malformed tool arguments back to the model without executing an action", async () => {
    const pet = createInitialPet("Mochi");
    const client = new FakeToolCallingClient([
      {
        content: null,
        toolCalls: [
          { id: "call-1", name: "feed_pet", arguments: "not-json" },
        ],
      },
      { content: "参数不对，我还没有执行喂食。", toolCalls: [] },
    ]);

    const result = await runAgentTurn(
      pet,
      "喂你",
      client,
      new PetToolRegistry(),
    );

    expect(result.ok).toBe(false);
    expect(result.reply).toBe("参数不对，我还没有执行喂食。");
    expect(result.error).toBe("INVALID_TOOL_ARGUMENTS_JSON");
    expect(result.state.hunger).toBe(pet.hunger);
    expect(result.events).toEqual([]);
  });

  it("executes multiple tool calls from one model response in order", async () => {
    const client = new FakeToolCallingClient([
      {
        content: null,
        toolCalls: [
          { id: "call-1", name: "feed_pet", arguments: '{"amount":20}' },
          { id: "call-2", name: "pet_the_pet", arguments: "{}" },
        ],
      },
      { content: "我帮你照顾好啦！", toolCalls: [] },
    ]);

    const result = await runAgentTurn(
      createInitialPet("Mochi"),
      "照顾一下自己",
      client,
      new PetToolRegistry(),
    );

    expect(result.ok).toBe(true);
    expect(result.reply).toBe("我帮你照顾好啦！");
    expect(result.state).toEqual(
      expect.objectContaining({ hunger: 10, mood: 75 }),
    );
    expect(result.events.map((event) => event.type)).toEqual(["feed", "pet"]);
  });

  it("stops after the maximum number of agent steps", async () => {
    const client = new FakeToolCallingClient([
      {
        content: null,
        toolCalls: [
          { id: "call-1", name: "feed_pet", arguments: '{"amount":1}' },
        ],
      },
      {
        content: null,
        toolCalls: [
          { id: "call-2", name: "feed_pet", arguments: '{"amount":1}' },
        ],
      },
      {
        content: null,
        toolCalls: [
          { id: "call-3", name: "feed_pet", arguments: '{"amount":1}' },
        ],
      },
    ]);

    const result = await runAgentTurn(
      createInitialPet("Mochi"),
      "一直喂你",
      client,
      new PetToolRegistry(),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("MAX_AGENT_STEPS_EXCEEDED");
    expect(client.toolCalls).toHaveLength(3);
    expect(result.state.hunger).toBe(27);
    expect(result.events).toHaveLength(3);
  });

  it("logs model decisions and execution results in debug mode", async () => {
    const client = new FakeToolCallingClient([
      {
        content: null,
        toolCalls: [
          {
            id: "call-1",
            name: "feed_pet",
            arguments: '{"amount":20}',
          },
        ],
      },
      { content: "完成啦！", toolCalls: [] },
    ]);
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await runAgentTurn(
      createInitialPet("Mochi"),
      "给你喂 20",
      client,
      new PetToolRegistry(),
      [],
      { debug: true },
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dev][agent] model decision"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dev][tool] tool execution result"),
    );
    logSpy.mockRestore();
  });
});
