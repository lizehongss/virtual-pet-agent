import { createInitialPet } from "../src/domain/pet";
import {
  PET_TOOL_DEFINITIONS,
  PetToolRegistry,
} from "../src/agent/tools";

describe("pet tool registry", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("exposes only the allowlisted pet tools", () => {
    const registry = new PetToolRegistry();

    expect(registry.getDefinitions().map((tool) => tool.function.name)).toEqual(
      PET_TOOL_DEFINITIONS.map((tool) => tool.function.name),
    );
  });

  it("validates arguments before executing feed_pet", async () => {
    const registry = new PetToolRegistry();
    const pet = createInitialPet("Mochi", now);

    const result = await registry.execute("feed_pet", { amount: 20 }, {
      pet,
      now,
    });

    expect(result.ok).toBe(true);
    expect(result.state.hunger).toBe(10);
    expect(result.event?.type).toBe("feed");
  });

  it("rejects invalid arguments and does not change state", async () => {
    const registry = new PetToolRegistry();
    const pet = createInitialPet("Mochi", now);

    const result = await registry.execute("feed_pet", { amount: 0 }, {
      pet,
      now,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("INVALID_TOOL_ARGUMENTS");
    expect(result.state).toEqual(pet);
  });

  it("gets status without applying an interaction action", async () => {
    const registry = new PetToolRegistry();
    const pet = createInitialPet("Mochi", now);

    const result = await registry.execute("get_pet_status", {}, {
      pet,
      now,
    });

    expect(result.ok).toBe(true);
    expect(result.state.mood).toBe(pet.mood);
    expect(result.message).toContain("Mochi 当前状态");
    expect(result.event).toBeUndefined();
  });

  it("rejects unknown tools", async () => {
    const registry = new PetToolRegistry();
    const pet = createInitialPet("Mochi", now);

    const result = await registry.execute("delete_pet", {}, { pet, now });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Unknown tool: delete_pet");
  });
});
