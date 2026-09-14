import { randomUUID } from "node:crypto";
import {
  advanceTime,
  clamp,
  isPetSleeping,
  PetAction,
  PetEvent,
  PetEventType,
  PetState,
} from "./pet";

export type ActionErrorCode =
  | "INVALID_ACTION"
  | "PET_SLEEPING"
  | "NOT_ENOUGH_ENERGY";

export type ActionError = {
  code: ActionErrorCode;
  message: string;
};

export type ActionResult =
  | {
      ok: true;
      state: PetState;
      event: PetEvent;
    }
  | {
      ok: false;
      state: PetState;
      error: ActionError;
    };

const HOUR_IN_MS = 60 * 60 * 1000;

function isValidWholeNumber(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function failure(
  state: PetState,
  code: ActionErrorCode,
  message: string,
): ActionResult {
  return {
    ok: false,
    state,
    error: { code, message },
  };
}

function success(
  state: PetState,
  type: PetEventType,
  timestamp: string,
  details: Record<string, number | string>,
): ActionResult {
  return {
    ok: true,
    state,
    event: {
      id: randomUUID(),
      petId: state.id,
      type,
      timestamp,
      details,
    },
  };
}

export function applyPetAction(
  currentPet: PetState,
  action: PetAction,
  now = new Date(),
): ActionResult {
  const pet = advanceTime(currentPet, now);

  switch (action.type) {
    // 喂食量越大，饥饿度下降越多；单次最多喂 100。
    case "feed": {
      if (!isValidWholeNumber(action.amount, 1, 100)) {
        return failure(pet, "INVALID_ACTION", "喂食量必须是 1 到 100 的整数。");
      }

      if (isPetSleeping(pet, now)) {
        return failure(pet, "PET_SLEEPING", `${pet.name} 正在睡觉，暂时不能喂食。`);
      }

      const nextPet: PetState = {
        ...pet,
        hunger: clamp(pet.hunger - action.amount),
        mood: clamp(
          pet.mood + Math.min(10, Math.max(1, Math.ceil(action.amount / 10))),
        ),
        updatedAt: now.toISOString(),
      };

      return success(nextPet, "feed", nextPet.updatedAt, {
        amount: action.amount,
      });
    }

    // 玩耍按分钟消耗精力；精力不足或宠物睡觉时不能执行。
    case "play": {
      if (!isValidWholeNumber(action.minutes, 1, 60)) {
        return failure(
          pet,
          "INVALID_ACTION",
          "玩耍时长必须是 1 到 60 的整数分钟。",
        );
      }

      if (isPetSleeping(pet, now)) {
        return failure(pet, "PET_SLEEPING", `${pet.name} 正在睡觉，暂时不能玩耍。`);
      }

      const energyCost = Math.max(1, Math.ceil(action.minutes / 5));
      if (pet.energy < energyCost) {
        return failure(
          pet,
          "NOT_ENOUGH_ENERGY",
          `${pet.name} 的精力不足，先休息一会儿吧。`,
        );
      }

      const nextPet: PetState = {
        ...pet,
        hunger: clamp(pet.hunger + Math.ceil(action.minutes / 15)),
        energy: clamp(pet.energy - energyCost),
        mood: clamp(
          pet.mood + Math.min(20, Math.max(1, Math.ceil(action.minutes / 10) * 4)),
        ),
        updatedAt: now.toISOString(),
      };

      return success(nextPet, "play", nextPet.updatedAt, {
        minutes: action.minutes,
        energyCost,
      });
    }

    // 睡眠会设置预计醒来时间，睡眠期间不能执行其他互动动作。
    case "sleep": {
      if (!isValidWholeNumber(action.hours, 1, 12)) {
        return failure(
          pet,
          "INVALID_ACTION",
          "睡眠时长必须是 1 到 12 的整数小时。",
        );
      }

      if (isPetSleeping(pet, now)) {
        return failure(pet, "PET_SLEEPING", `${pet.name} 已经在睡觉了。`);
      }

      const sleepUntil = new Date(now.getTime() + action.hours * HOUR_IN_MS);
      const nextPet: PetState = {
        ...pet,
        sleepUntil: sleepUntil.toISOString(),
        mood: clamp(pet.mood + 1),
        updatedAt: now.toISOString(),
      };

      return success(nextPet, "sleep", nextPet.updatedAt, {
        hours: action.hours,
        sleepUntil: sleepUntil.toISOString(),
      });
    }

    // 抚摸是最轻量的互动，只改变心情，不消耗饥饿度和精力。
    case "pet": {
      if (isPetSleeping(pet, now)) {
        return failure(pet, "PET_SLEEPING", `${pet.name} 正在睡觉，轻一点哦。`);
      }

      const nextPet: PetState = {
        ...pet,
        mood: clamp(pet.mood + 3),
        updatedAt: now.toISOString(),
      };

      return success(nextPet, "pet", nextPet.updatedAt, {});
    }

    default:
      return failure(pet, "INVALID_ACTION", "不支持这个宠物动作。");
  }
}
