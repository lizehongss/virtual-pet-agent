import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgentTurn } from "./agent/agent-turn";
import { createLlmClientFromConfigFile } from "./agent/llm-client";
import type { ChatMessage, ToolCallingLlmClient } from "./agent/llm-client";
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

    const result = await runAgentTurn(
      pet,
      message,
      llmClient,
      toolRegistry,
      chatHistory,
    );
    pet = result.state;
    await onTurn(result);
    console.log(`\n${pet.name}：${result.reply}`);

    if (result.ok) {
      chatHistory.push(
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      );
      if (chatHistory.length > 20) {
        chatHistory.splice(0, chatHistory.length - 20);
      }
    }
  }
}

export async function runCli(
  repository: PetRepository = new JsonPetRepository(),
): Promise<void> {
  const readline = createInterface({ input, output });
  let pet = await repository.getFirstPet();
  const llmClient = await createLlmClientFromConfigFile();
  const chatHistory: ChatMessage[] = [];
  const toolRegistry = new PetToolRegistry();

  if (!pet) {
    pet = createInitialPet("Mochi");
    await repository.savePet(pet);
  }

  console.log("欢迎来到 Virtual Pet Agent（M3：AI 对话）");

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
              if (result.event) {
                await repository.appendEvent(result.event);
              }
            },
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
