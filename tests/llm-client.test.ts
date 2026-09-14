import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLlmClientFromConfigFile,
  OpenAICompatibleLlmClient,
  UnavailableLlmClient,
} from "../src/agent/llm-client";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
} from "../src/config/llm-config";

describe("LLM client configuration", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "virtual-pet-llm-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("uses a safe fallback when the local config file is missing", async () => {
    const filePath = join(temporaryDirectory, "llm.local.json");
    const client = await createLlmClientFromConfigFile(filePath);

    expect(client).toBeInstanceOf(UnavailableLlmClient);
    await expect(
      client.generateText({ system: "system", messages: [] }),
    ).rejects.toThrow("LLM config not found");
  });

  it("uses DeepSeek defaults from the local config file", async () => {
    const filePath = join(temporaryDirectory, "llm.local.json");
    await writeFile(
      filePath,
      JSON.stringify({ apiKey: "test-key" }),
      "utf8",
    );

    const client = await createLlmClientFromConfigFile(filePath);

    expect(client).toBeInstanceOf(OpenAICompatibleLlmClient);

    const config = (client as unknown as { config: {
      baseUrl: string;
      model: string;
    } }).config;

    expect(config.baseUrl).toBe(DEFAULT_DEEPSEEK_BASE_URL);
    expect(config.model).toBe(DEFAULT_DEEPSEEK_MODEL);
  });

  it("supports switching provider settings in the config file", async () => {
    const filePath = join(temporaryDirectory, "llm.local.json");
    await writeFile(
      filePath,
      JSON.stringify({
        apiKey: "other-provider-key",
        baseUrl: "https://other-provider.example/v1",
        model: "other-model",
      }),
      "utf8",
    );

    const client = await createLlmClientFromConfigFile(filePath);

    expect(client).toBeInstanceOf(OpenAICompatibleLlmClient);

    const config = (client as unknown as { config: {
      baseUrl: string;
      model: string;
    } }).config;

    expect(config.baseUrl).toBe("https://other-provider.example/v1");
    expect(config.model).toBe("other-model");
  });

  it("rejects malformed local config instead of silently using defaults", async () => {
    const filePath = join(temporaryDirectory, "llm.local.json");
    await writeFile(filePath, "{not-json}", "utf8");

    await expect(createLlmClientFromConfigFile(filePath)).rejects.toThrow(
      "LLM config is not valid JSON",
    );
  });

  it("logs the model response only when debug mode is enabled", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
        JSON.stringify({
          choices: [{ message: { content: "你好呀！" } }],
        }),
        { status: 200 },
        ),
    );
    const logSpy = jest
      .spyOn(console, "log")
      .mockImplementation(() => undefined);

    const client = new OpenAICompatibleLlmClient({
      apiKey: "test-key",
      baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      model: DEFAULT_DEEPSEEK_MODEL,
      timeoutMs: 30_000,
      debug: true,
    });

    await client.generateText({ system: "system", messages: [] });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dev][llm] model text response"),
    );

    logSpy.mockClear();
    const quietClient = new OpenAICompatibleLlmClient({
      apiKey: "test-key",
      baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
      model: DEFAULT_DEEPSEEK_MODEL,
      timeoutMs: 30_000,
      debug: false,
    });

    await quietClient.generateText({ system: "system", messages: [] });

    expect(logSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    logSpy.mockRestore();
  });
});
