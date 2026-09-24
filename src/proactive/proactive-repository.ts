import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const PROACTIVE_RULE_IDS = [
  "hunger_high",
  "energy_low",
  "inactivity",
] as const;

export type ProactiveRuleId = (typeof PROACTIVE_RULE_IDS)[number];

export type ProactivePetState = {
  /** 最近一次用户互动的时间，用于判断长时间未互动。 */
  lastInteractionAt: string;
  /** 每条规则最近一次触发时间，用于调试和重启恢复。 */
  lastTriggeredAt: Partial<Record<ProactiveRuleId, string>>;
};

export type ProactiveNotification = {
  /** 主动提醒的唯一标识。 */
  id: string;
  /** 产生提醒的宠物标识。 */
  petId: string;
  /** 触发提醒的规则。 */
  ruleId: ProactiveRuleId;
  /** 规则触发的可读原因。 */
  reason: string;
  /** 规则被判断为满足条件的时间。 */
  triggeredAt: string;
  /** 最终展示给用户的宠物口吻文本。 */
  message: string;
};

export interface ProactiveRepository {
  getState(petId: string): Promise<ProactivePetState | null>;
  saveState(petId: string, state: ProactivePetState): Promise<void>;
  appendNotification(notification: ProactiveNotification): Promise<void>;
  getNotifications(petId: string): Promise<ProactiveNotification[]>;
}

type ProactiveStore = {
  version: 1;
  pets: Record<string, ProactivePetState>;
  notifications: ProactiveNotification[];
};

function createEmptyStore(): ProactiveStore {
  return {
    version: 1,
    pets: {},
    notifications: [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuleId(value: unknown): value is ProactiveRuleId {
  return (
    typeof value === "string" &&
    (PROACTIVE_RULE_IDS as readonly string[]).includes(value)
  );
}

function isValidPetState(value: unknown): value is ProactivePetState {
  if (!isRecord(value) || typeof value.lastInteractionAt !== "string") {
    return false;
  }

  if (!isRecord(value.lastTriggeredAt)) {
    return false;
  }

  return Object.entries(value.lastTriggeredAt).every(
    ([ruleId, timestamp]) => isRuleId(ruleId) && typeof timestamp === "string",
  );
}

function isValidNotification(
  value: unknown,
): value is ProactiveNotification {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.petId === "string" &&
    isRuleId(value.ruleId) &&
    typeof value.reason === "string" &&
    typeof value.triggeredAt === "string" &&
    typeof value.message === "string"
  );
}

function parseStore(raw: string): ProactiveStore {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Proactive store contains invalid JSON");
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !isRecord(parsed.pets) ||
    !Array.isArray(parsed.notifications)
  ) {
    throw new Error("Proactive store has an unsupported format");
  }

  if (!Object.values(parsed.pets).every(isValidPetState)) {
    throw new Error("Proactive store contains an invalid pet state");
  }

  if (!parsed.notifications.every(isValidNotification)) {
    throw new Error("Proactive store contains an invalid notification");
  }

  return {
    version: 1,
    pets: clone(parsed.pets) as Record<string, ProactivePetState>,
    notifications: clone(parsed.notifications) as ProactiveNotification[],
  };
}

export class InMemoryProactiveRepository implements ProactiveRepository {
  private readonly states = new Map<string, ProactivePetState>();

  private readonly notifications: ProactiveNotification[] = [];

  async getState(petId: string): Promise<ProactivePetState | null> {
    const state = this.states.get(petId);
    return state ? clone(state) : null;
  }

  async saveState(
    petId: string,
    state: ProactivePetState,
  ): Promise<void> {
    this.states.set(petId, clone(state));
  }

  async appendNotification(
    notification: ProactiveNotification,
  ): Promise<void> {
    this.notifications.push(clone(notification));
  }

  async getNotifications(petId: string): Promise<ProactiveNotification[]> {
    return clone(
      this.notifications.filter((notification) => notification.petId === petId),
    );
  }
}

export class JsonProactiveRepository implements ProactiveRepository {
  private readonly filePath: string;

  constructor(
    filePath = resolve(process.cwd(), "data", "proactive-store.json"),
  ) {
    this.filePath = resolve(filePath);
  }

  getFilePath(): string {
    return this.filePath;
  }

  private async readStore(): Promise<ProactiveStore> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return parseStore(raw);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return createEmptyStore();
      }

      throw error;
    }
  }

  private async writeStore(store: ProactiveStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(store, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, this.filePath);
  }

  async getState(petId: string): Promise<ProactivePetState | null> {
    const store = await this.readStore();
    const state = store.pets[petId];
    return state ? clone(state) : null;
  }

  async saveState(
    petId: string,
    state: ProactivePetState,
  ): Promise<void> {
    const store = await this.readStore();
    store.pets[petId] = clone(state);
    await this.writeStore(store);
  }

  async appendNotification(
    notification: ProactiveNotification,
  ): Promise<void> {
    const store = await this.readStore();
    store.notifications.push(clone(notification));
    await this.writeStore(store);
  }

  async getNotifications(petId: string): Promise<ProactiveNotification[]> {
    const store = await this.readStore();
    return clone(
      store.notifications.filter(
        (notification) => notification.petId === petId,
      ),
    );
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
