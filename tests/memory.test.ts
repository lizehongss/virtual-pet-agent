import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InMemoryMemoryRepository,
  JsonMemoryRepository,
} from "../src/memory/memory-repository";
import {
  extractLongTermMemories,
  PetMemoryService,
} from "../src/memory/memory-service";
import type { ChatMessage } from "../src/agent/llm-client";
import {
  appendShortTermTurn,
  getRecentMessages,
} from "../src/memory/short-term-memory";

describe("pet memory", () => {
  it("extracts only explicit long-term facts", () => {
    expect(extractLongTermMemories("我饿了")).toEqual([]);
    expect(extractLongTermMemories("我的名字是小明")).toEqual([
      expect.objectContaining({
        kind: "identity",
        content: "用户的名字是小明",
        keywords: expect.arrayContaining(["名字", "小明"]),
        importance: 1,
      }),
    ]);
    expect(extractLongTermMemories("我不喜欢香菜")).toEqual([
      expect.objectContaining({
        kind: "preference",
        content: "用户不喜欢香菜",
        keywords: expect.arrayContaining(["不喜欢", "香菜"]),
      }),
    ]);
    expect(extractLongTermMemories("记住我们周末一起玩")).toEqual([
      expect.objectContaining({
        kind: "agreement",
        content: "我们周末一起玩",
        keywords: expect.arrayContaining(["记住", "约定"]),
      }),
    ]);
  });

  it("deduplicates explicit memories and retrieves them by keywords", async () => {
    const service = new PetMemoryService(new InMemoryMemoryRepository());
    const petId = "pet-1";

    await service.rememberFromUserMessage(petId, "我的名字是小明");
    await service.rememberFromUserMessage(petId, "我的名字是小明");
    await service.rememberFromUserMessage(petId, "我喜欢咖啡");
    await service.rememberFromUserMessage(petId, "记住我们周末一起玩");

    const memories = await service.getRelevantMemories(
      petId,
      "你还记得我的名字吗",
    );
    expect(memories).toHaveLength(1);
    expect(memories[0].content).toBe("用户的名字是小明");

    const generalRecall = await service.getRelevantMemories(
      petId,
      "你还记得我吗",
    );
    expect(generalRecall[0].content).toBe("用户的名字是小明");

    const preferences = await service.getRelevantMemories(
      petId,
      "我喜欢什么",
    );
    expect(preferences[0].content).toBe("用户喜欢咖啡");

    const agreements = await service.getRelevantMemories(
      petId,
      "我们之前约定了什么",
    );
    expect(agreements[0].content).toBe("我们周末一起玩");
  });

  it("persists long-term memories in JSON and reads them after restart", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "virtual-pet-memory-"));
    try {
      const filePath = join(temporaryDirectory, "data", "memory-store.json");
      const service = new PetMemoryService(new JsonMemoryRepository(filePath));

      await service.rememberFromUserMessage("pet-1", "我的名字是小明");

      const restartedService = new PetMemoryService(
        new JsonMemoryRepository(filePath),
      );
      const memories = await restartedService.getRelevantMemories(
        "pet-1",
        "我的名字是什么",
      );
      const rawStore = await readFile(filePath, "utf8");

      expect(memories[0].content).toBe("用户的名字是小明");
      expect(rawStore).toContain('"version": 1');
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("creates an empty JSON store on first access", async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "virtual-pet-memory-"));
    try {
      const filePath = join(temporaryDirectory, "data", "memory-store.json");
      const repository = new JsonMemoryRepository(filePath);

      await expect(repository.listMemories("pet-1")).resolves.toEqual([]);
      await expect(readFile(filePath, "utf8")).resolves.toContain(
        '"version": 1',
      );
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("keeps short-term messages bounded", () => {
    const history: ChatMessage[] = [];

    for (let index = 0; index < 12; index += 1) {
      appendShortTermTurn(history, `用户消息 ${index}`, `回复 ${index}`);
    }

    expect(history).toHaveLength(20);
    expect(getRecentMessages(history)[0].content).toBe("用户消息 7");
    expect(getRecentMessages(history).at(-1)?.content).toBe("回复 11");
  });
});
