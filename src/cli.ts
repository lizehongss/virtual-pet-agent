import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { applyPetAction } from "./domain/actions";
import type { PetAction } from "./domain/pet";
import {
  advanceTime,
  createInitialPet,
  isPetSleeping,
} from "./domain/pet";
import type { PetState } from "./domain/pet";
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

export async function runCli(
  repository: PetRepository = new JsonPetRepository(),
): Promise<void> {
  const readline = createInterface({ input, output });
  let pet = await repository.getFirstPet();

  if (!pet) {
    pet = createInitialPet("Mochi");
    await repository.savePet(pet);
  }

  console.log("欢迎来到 Virtual Pet Agent（M1：确定性宠物核心）");

  try {
    while (true) {
      pet = advanceTime(pet);
      await repository.savePet(pet);
      console.log(
        "\n请选择：1 查看状态  2 喂食  3 玩耍  4 睡觉  5 抚摸  0 退出",
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
