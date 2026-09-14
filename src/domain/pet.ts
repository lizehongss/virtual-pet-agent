import { randomUUID } from "node:crypto";

export const PET_LIMITS = {
  min: 0,
  max: 100,
} as const;

const HOUR_IN_MS = 60 * 60 * 1000;

export type PetEventType = "feed" | "play" | "sleep" | "pet";

export type PetAction =
  /** 喂食宠物，降低饥饿度并提升少量心情。 */
  | { type: "feed"; amount: number }
  /** 和宠物玩耍，消耗精力并提升心情，同时增加少量饥饿度。 */
  | { type: "play"; minutes: number }
  /** 让宠物睡觉，在指定时间内恢复精力。 */
  | { type: "sleep"; hours: number }
  /** 抚摸宠物，只提升心情，不消耗精力。 */
  | { type: "pet" };

export type PetState = {
  /** 宠物的唯一标识，用于区分不同宠物。 */
  id: string;
  /** 宠物展示名称，例如 Mochi。 */
  name: string;
  /** 饥饿程度，范围 0-100，数值越高表示越饿。 */
  hunger: number;
  /** 当前精力，范围 0-100，数值越高表示越有活力。 */
  energy: number;
  /** 当前心情，范围 0-100，数值越高表示心情越好。 */
  mood: number;
  /** 当前健康度，范围 0-100，数值越高表示越健康。 */
  health: number;
  /** 最近一次状态更新的 ISO 8601 时间，用于计算时间流逝。 */
  updatedAt: string;
  /** 预计醒来的 ISO 8601 时间；为 null 表示宠物当前没有睡觉。 */
  sleepUntil: string | null;
};

export type PetEvent = {
  id: string;
  petId: string;
  type: PetEventType;
  timestamp: string;
  details: Record<string, number | string>;
};

export function clamp(value: number): number {
  return Math.min(PET_LIMITS.max, Math.max(PET_LIMITS.min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function createInitialPet(
  name = "Mochi",
  now = new Date(),
  id = randomUUID(),
): PetState {
  return {
    id,
    name,
    hunger: 30,
    energy: 80,
    mood: 70,
    health: 100,
    updatedAt: now.toISOString(),
    sleepUntil: null,
  };
}

export function isPetSleeping(
  pet: PetState,
  now = new Date(),
): boolean {
  if (!pet.sleepUntil) {
    return false;
  }

  return new Date(pet.sleepUntil).getTime() > now.getTime();
}

/**
 * 根据距离上次更新时间的时长，让宠物的自然状态发生变化。
 *
 * 规则保持简单且确定：每小时饥饿度 +5；清醒时每小时精力 -2；
 * 睡觉时每小时精力 +10。饥饿度过高或精力过低会带来健康损耗。
 */
export function advanceTime(
  pet: PetState,
  now = new Date(),
): PetState {
  const previousTime = new Date(pet.updatedAt);
  const nowTime = now.getTime();

  if (Number.isNaN(previousTime.getTime())) {
    throw new Error("Pet updatedAt is not a valid ISO date");
  }

  if (nowTime <= previousTime.getTime()) {
    return { ...pet };
  }

  const elapsedMs = nowTime - previousTime.getTime();
  const sleepEndTime = pet.sleepUntil
    ? new Date(pet.sleepUntil).getTime()
    : null;
  const sleepingMs =
    sleepEndTime !== null
      ? Math.max(0, Math.min(elapsedMs, sleepEndTime - previousTime.getTime()))
      : 0;
  const awakeMs = elapsedMs - sleepingMs;
  const elapsedHours = elapsedMs / HOUR_IN_MS;
  const sleepingHours = sleepingMs / HOUR_IN_MS;
  const awakeHours = awakeMs / HOUR_IN_MS;

  const hunger = clamp(round(pet.hunger + elapsedHours * 5));
  const energy = clamp(
    round(pet.energy + sleepingHours * 10 - awakeHours * 2),
  );
  const stressPerHour = hunger >= 90 || energy <= 10 ? 1 : 0;
  const health = clamp(round(pet.health - stressPerHour * elapsedHours));
  const mood = clamp(
    round(pet.mood + sleepingHours * 2 - (hunger >= 90 ? awakeHours : 0)),
  );

  return {
    ...pet,
    hunger,
    energy,
    mood,
    health,
    sleepUntil:
      sleepEndTime !== null && nowTime < sleepEndTime
        ? pet.sleepUntil
        : null,
    updatedAt: now.toISOString(),
  };
}
