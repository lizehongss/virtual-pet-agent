import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPetAction } from "../src/domain/actions";
import { createInitialPet } from "../src/domain/pet";
import {
  InMemoryPetRepository,
  JsonPetRepository,
} from "../src/memory/pet-repository";

describe("pet repositories", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "virtual-pet-agent-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("stores and retrieves a pet in memory", async () => {
    const repository = new InMemoryPetRepository();
    const pet = createInitialPet("Mochi", now);

    await repository.savePet(pet);
    const savedPet = await repository.getPet(pet.id);

    expect(savedPet).toEqual(pet);
  });

  it("persists a pet and its events in a JSON file", async () => {
    const filePath = join(temporaryDirectory, "data", "pet-store.json");
    const repository = new JsonPetRepository(filePath);
    const pet = createInitialPet("Mochi", now);
    const actionResult = applyPetAction(
      pet,
      { type: "feed", amount: 20 },
      now,
    );

    if (!actionResult.ok) {
      throw new Error("Expected feeding to succeed in repository test");
    }

    await repository.savePet(actionResult.state);
    await repository.appendEvent(actionResult.event);

    const restartedRepository = new JsonPetRepository(filePath);
    const restoredPet = await restartedRepository.getPet(pet.id);
    const restoredEvents = await restartedRepository.getEvents(pet.id);
    const rawStore = await readFile(filePath, "utf8");

    expect(restoredPet).toEqual(actionResult.state);
    expect(restoredEvents).toEqual([actionResult.event]);
    expect(rawStore).toContain('"version": 1');
  });

  it("returns no pet when the JSON store does not exist", async () => {
    const filePath = join(temporaryDirectory, "missing", "pet-store.json");
    const repository = new JsonPetRepository(filePath);

    await expect(repository.getFirstPet()).resolves.toBeNull();
    await expect(repository.getEvents("unknown-pet")).resolves.toEqual([]);
  });
});
