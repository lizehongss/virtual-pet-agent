import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { PetEvent, PetState } from "../domain/pet";

export interface PetRepository {
  getPet(id: string): Promise<PetState | null>;
  getFirstPet(): Promise<PetState | null>;
  savePet(pet: PetState): Promise<void>;
  appendEvent(event: PetEvent): Promise<void>;
  getEvents(petId: string): Promise<PetEvent[]>;
}

type PetStore = {
  version: 1;
  pets: Record<string, PetState>;
  events: PetEvent[];
};

function createEmptyStore(): PetStore {
  return {
    version: 1,
    pets: {},
    events: [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPetState(value: unknown): value is PetState {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.hunger === "number" &&
    typeof value.energy === "number" &&
    typeof value.mood === "number" &&
    typeof value.health === "number" &&
    typeof value.updatedAt === "string" &&
    (typeof value.sleepUntil === "string" || value.sleepUntil === null)
  );
}

function isValidPetEvent(value: unknown): value is PetEvent {
  if (!isRecord(value) || !isRecord(value.details)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.petId === "string" &&
    (value.type === "feed" ||
      value.type === "play" ||
      value.type === "sleep" ||
      value.type === "pet") &&
    typeof value.timestamp === "string" &&
    Object.values(value.details).every(
      (detail) => typeof detail === "string" || typeof detail === "number",
    )
  );
}

function parseStore(raw: string): PetStore {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Pet store contains invalid JSON");
  }

  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.pets)) {
    throw new Error("Pet store has an unsupported format");
  }

  const pets = Object.values(parsed.pets);
  if (!pets.every(isValidPetState)) {
    throw new Error("Pet store contains an invalid pet state");
  }

  if (!Array.isArray(parsed.events) || !parsed.events.every(isValidPetEvent)) {
    throw new Error("Pet store contains an invalid event");
  }

  return {
    version: 1,
    pets: clone(parsed.pets) as Record<string, PetState>,
    events: clone(parsed.events) as PetEvent[],
  };
}

export class InMemoryPetRepository implements PetRepository {
  private readonly pets = new Map<string, PetState>();

  private readonly events: PetEvent[] = [];

  async getPet(id: string): Promise<PetState | null> {
    const pet = this.pets.get(id);
    return pet ? clone(pet) : null;
  }

  async getFirstPet(): Promise<PetState | null> {
    const pet = this.pets.values().next().value as PetState | undefined;
    return pet ? clone(pet) : null;
  }

  async savePet(pet: PetState): Promise<void> {
    this.pets.set(pet.id, clone(pet));
  }

  async appendEvent(event: PetEvent): Promise<void> {
    this.events.push(clone(event));
  }

  async getEvents(petId: string): Promise<PetEvent[]> {
    return clone(this.events.filter((event) => event.petId === petId));
  }
}

export class JsonPetRepository implements PetRepository {
  private readonly filePath: string;

  constructor(filePath = resolve(process.cwd(), "data", "pet-store.json")) {
    this.filePath = resolve(filePath);
  }

  private async readStore(): Promise<PetStore> {
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

  private async writeStore(store: PetStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify(store, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, this.filePath);
  }

  async getPet(id: string): Promise<PetState | null> {
    const store = await this.readStore();
    const pet = store.pets[id];
    return pet ? clone(pet) : null;
  }

  async getFirstPet(): Promise<PetState | null> {
    const store = await this.readStore();
    const pet = Object.values(store.pets)[0];
    return pet ? clone(pet) : null;
  }

  async savePet(pet: PetState): Promise<void> {
    const store = await this.readStore();
    store.pets[pet.id] = clone(pet);
    await this.writeStore(store);
  }

  async appendEvent(event: PetEvent): Promise<void> {
    const store = await this.readStore();
    store.events.push(clone(event));
    await this.writeStore(store);
  }

  async getEvents(petId: string): Promise<PetEvent[]> {
    const store = await this.readStore();
    return clone(store.events.filter((event) => event.petId === petId));
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.code === "ENOENT"
  );
}
