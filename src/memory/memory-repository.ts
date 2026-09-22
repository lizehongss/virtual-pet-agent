import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

export type MemoryKind =
  | "identity"
  | "preference"
  | "fact"
  | "agreement";

export type PetMemory = {
  /** 记忆的唯一标识。 */
  id: string;
  /** 记忆所属的宠物。 */
  petId: string;
  /** 记忆类别，用于提示词展示和检索排序。 */
  kind: MemoryKind;
  /** 已确认的记忆事实，不保存模型推测。 */
  content: string;
  /** 用于第一版关键词检索的关键词。 */
  keywords: string[];
  /** 记忆重要程度，范围 0-1。 */
  importance: number;
  /** 记忆首次创建时间。 */
  createdAt: string;
  /** 记忆最近更新时间。 */
  updatedAt: string;
};

export interface MemoryRepository {
  listMemories(petId: string): Promise<PetMemory[]>;
  saveMemory(memory: PetMemory): Promise<void>;
}

type MemoryStore = {
  version: 1;
  memories: PetMemory[];
};

function createEmptyStore(): MemoryStore {
  return {
    version: 1,
    memories: [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMemoryKind(value: unknown): value is MemoryKind {
  return (
    value === "identity" ||
    value === "preference" ||
    value === "fact" ||
    value === "agreement"
  );
}

function isValidPetMemory(value: unknown): value is PetMemory {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.petId === "string" &&
    isMemoryKind(value.kind) &&
    typeof value.content === "string" &&
    Array.isArray(value.keywords) &&
    value.keywords.every((keyword) => typeof keyword === "string") &&
    typeof value.importance === "number" &&
    Number.isFinite(value.importance) &&
    value.importance >= 0 &&
    value.importance <= 1 &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function parseStore(raw: string): MemoryStore {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Memory store contains invalid JSON");
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.memories) ||
    !parsed.memories.every(isValidPetMemory)
  ) {
    throw new Error("Memory store has an unsupported format");
  }

  return {
    version: 1,
    memories: clone(parsed.memories) as PetMemory[],
  };
}

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly memories = new Map<string, PetMemory>();

  async listMemories(petId: string): Promise<PetMemory[]> {
    return clone(
      [...this.memories.values()].filter((memory) => memory.petId === petId),
    );
  }

  async saveMemory(memory: PetMemory): Promise<void> {
    this.memories.set(memory.id, clone(memory));
  }
}

export class JsonMemoryRepository implements MemoryRepository {
  private readonly filePath: string;

  constructor(
    filePath = resolve(process.cwd(), "data", "memory-store.json"),
  ) {
    this.filePath = resolve(filePath);
  }

  private async readStore(): Promise<MemoryStore> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return parseStore(raw);
    } catch (error) {
      if (isFileNotFoundError(error)) {
        const store = createEmptyStore();
        await this.writeStore(store);
        return store;
      }

      throw error;
    }
  }

  getFilePath(): string {
    return this.filePath;
  }

  private async writeStore(store: MemoryStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(store, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, this.filePath);
  }

  async listMemories(petId: string): Promise<PetMemory[]> {
    const store = await this.readStore();
    return clone(store.memories.filter((memory) => memory.petId === petId));
  }

  async saveMemory(memory: PetMemory): Promise<void> {
    const store = await this.readStore();
    store.memories = store.memories.filter(
      (storedMemory) => storedMemory.id !== memory.id,
    );
    store.memories.push(clone(memory));
    await this.writeStore(store);
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
