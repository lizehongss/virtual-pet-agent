import { runChatMode } from "../src/cli";
import type {
  ChatMessage,
  GenerateTextInput,
  LlmClient,
  GenerateWithToolsInput,
  GenerateWithToolsResult,
  ToolCallingLlmClient,
} from "../src/agent/llm-client";
import { createInitialPet } from "../src/domain/pet";

class FakeLlmClient implements ToolCallingLlmClient {
  public readonly calls: GenerateTextInput[] = [];

  private responseNumber = 0;

  async generateText(input: GenerateTextInput): Promise<string> {
    this.calls.push(input);
    this.responseNumber += 1;
    return `回复 ${this.responseNumber}`;
  }

  async generateWithTools(
    input: GenerateWithToolsInput,
  ): Promise<GenerateWithToolsResult> {
    this.calls.push(input);
    this.responseNumber += 1;
    return { content: `回复 ${this.responseNumber}`, toolCalls: [] };
  }
}

describe("continuous chat mode", () => {
  it("keeps chatting until the user enters /exit", async () => {
    const inputs = ["你好", "你还记得我吗", "/exit"];
    const ask = jest.fn(async (_prompt: string) => inputs.shift() ?? "/exit");
    const client = new FakeLlmClient();
    const history: ChatMessage[] = [];
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    await runChatMode(ask, createInitialPet("Mochi"), client, history);

    expect(ask).toHaveBeenCalledTimes(3);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].messages).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "回复 1" },
      { role: "user", content: "你还记得我吗" },
    ]);
    expect(history).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "回复 1" },
      { role: "user", content: "你还记得我吗" },
      { role: "assistant", content: "回复 2" },
    ]);

    logSpy.mockRestore();
  });
});
