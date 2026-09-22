import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgentTurn } from "./agent/agent-turn";
import { createLlmClientFromConfigFile } from "./agent/llm-client";
import type { ChatMessage, ToolCallingLlmClient } from "./agent/llm-client";
import { devLog } from "./agent/debug";
import { applyPetAction } from "./domain/actions";
import type { PetAction } from "./domain/pet";
import {
  advanceTime,
  createInitialPet,
  isPetSleeping,
} from "./domain/pet";
import type { PetState } from "./domain/pet";
import { PetToolRegistry } from "./agent/tools";
import {
  InMemoryMemoryRepository,
  JsonMemoryRepository,
} from "./memory/memory-repository";
import type { PetMemory } from "./memory/memory-repository";
import { PetMemoryService } from "./memory/memory-service";
import { appendShortTermTurn } from "./memory/short-term-memory";
import {
  JsonPetRepository,
  PetRepository,
} from "./memory/pet-repository";

function printStatus(pet: PetState): void {
  const status = isPetSleeping(pet)
    ? `睡觉中，将于 ${pet.sleepUntil} 醒来`
    : "清醒";

  console.log(`\n${pet.name} 的状态`);
  console.log(`饥饿度: ${pet.hunger}/100`);
  console.log(`精力:   ${pet.energy}/100`);
  console.log(`心情:   ${pet.mood}/100`);
  console.log(`健康度: ${pet.health}/100`);
  console.log(`状态:   ${status}`);
}

function printActionResult(result: ReturnType<typeof applyPetAction>): void {
  if (!result.ok) {
    console.log(`操作失败：${result.error.message}`);
    return;
  }

  console.log(`操作成功：${result.event.type}`);
}

export async function runChatMode(
  ask: (prompt: string) => Promise<string>,
  initialPet: PetState,
  llmClient: ToolCallingLlmClient,
  chatHistory: ChatMessage[],
  toolRegistry = new PetToolRegistry(),
  onTurn: (result: Awaited<ReturnType<typeof runAgentTurn>>) => Promise<void> =
    async () => undefined,
  debug = false,
  memoryService = new PetMemoryService(new InMemoryMemoryRepository()),
): Promise<PetState> {
  let pet = initialPet;

  console.log("\n已进入连续聊天模式，输入 /exit 或 /quit 返回主菜单。");

  while (true) {
    pet = advanceTime(pet);
    const message = (await ask("你：")).trim();

    if (message === "/exit" || message === "/quit") {
      console.log("已退出聊天模式。");
      return pet;
    }

    let memories: PetMemory[] = [];
    try {
      const savedMemories =
        await memoryService.rememberFromUserMessage(pet.id, message);
      memories = await memoryService.getRelevantMemories(pet.id, message);

      devLog(
        "memory",
        "retrieved memories",
        { query: message, memories },
        debug,
      );

      if (savedMemories.length > 0) {
        devLog(
          "memory",
          "saved long-term memories",
          { memories: savedMemories },
          debug,
        );
      }
    } catch (error) {
      devLog(
        "memory",
        "memory operation failed",
        { error: error instanceof Error ? error.message : "Unknown memory error" },
        debug,
      );
    }

    const result = await runAgentTurn(
      pet,
      message,
      llmClient,
      toolRegistry,
      chatHistory,
      { debug, memories },
    );
    pet = result.state;
    await onTurn(result);
    console.log(`\n${pet.name}：${result.reply}`);

    appendShortTermTurn(chatHistory, message, result.reply);
  }
}

export async function runCli(
  repository: PetRepository = new JsonPetRepository(),
  debug = false,
): Promise<void> {
  const readline = createInterface({ input, output });
  let pet = await repository.getFirstPet();
  const llmClient = await createLlmClientFromConfigFile(undefined, { debug });
  const chatHistory: ChatMessage[] = [];
  const toolRegistry = new PetToolRegistry();
  const memoryRepository = new JsonMemoryRepository();
  const memoryService = new PetMemoryService(memoryRepository);

  devLog(
    "memory",
    "using memory store",
    { filePath: memoryRepository.getFilePath() },
    debug,
  );

  if (!pet) {
    pet = createInitialPet("Mochi");
    await repository.savePet(pet);
  }

  console.log("欢迎来到 Virtual Pet Agent（M6：记忆）");

  try {
    while (true) {
      pet = advanceTime(pet);
      await repository.savePet(pet);
      console.log(
        "\n请选择：1 查看状态  2 喂食  3 玩耍  4 睡觉  5 抚摸  6 进入聊天  0 退出",
      );
      const choice = (await readline.question("> ")).trim();

      if (choice === "0") {
        break;
      }

      let action: PetAction | null = null;

      switch (choice) {
        case "1":
          printStatus(pet);
          continue;
        case "2":
          action = {
            type: "feed",
            amount: Number(await readline.question("喂食量（1-100）：")),
          };
          break;
        case "3":
          action = {
            type: "play",
            minutes: Number(await readline.question("玩耍分钟数（1-60）：")),
          };
          break;
        case "4":
          action = {
            type: "sleep",
            hours: Number(await readline.question("睡眠小时数（1-12）：")),
          };
          break;
        case "5":
          action = { type: "pet" };
          break;
        case "6": {
          pet = await runChatMode(
            (prompt) => readline.question(prompt),
            pet,
            llmClient,
            chatHistory,
            toolRegistry,
            async (result) => {
              await repository.savePet(result.state);
              for (const event of result.events) {
                await repository.appendEvent(event);
              }
            },
            debug,
            memoryService,
          );
          continue;
        }
        default:
          console.log("无法识别这个选项。");
          continue;
      }

      const result = applyPetAction(pet, action);
      pet = result.state;
      await repository.savePet(pet);

      if (result.ok) {
        await repository.appendEvent(result.event);
      }

      printActionResult(result);
    }
  } finally {
    readline.close();
  }
}
