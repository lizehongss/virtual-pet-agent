import { applyPetAction } from "../src/domain/actions";
import { createInitialPet } from "../src/domain/pet";

describe("pet actions", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("feeds the pet and creates an event", () => {
    const pet = createInitialPet("Mochi", now);
    const result = applyPetAction(pet, { type: "feed", amount: 20 }, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.hunger).toBe(10);
    expect(result.state.mood).toBe(72);
    expect(result.event.type).toBe("feed");
    expect(result.event.details).toEqual({ amount: 20 });
  });

  it("plays with the pet and consumes energy", () => {
    const pet = createInitialPet("Mochi", now);
    const result = applyPetAction(pet, { type: "play", minutes: 20 }, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.energy).toBe(76);
    expect(result.state.hunger).toBe(32);
    expect(result.state.mood).toBe(78);
  });

  it("rejects play when the pet does not have enough energy", () => {
    const pet = { ...createInitialPet("Mochi", now), energy: 2 };
    const result = applyPetAction(pet, { type: "play", minutes: 20 }, now);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("NOT_ENOUGH_ENERGY");
    expect(result.state.energy).toBe(2);
  });

  it("puts the pet to sleep and blocks play until it wakes", () => {
    const pet = createInitialPet("Mochi", now);
    const sleepResult = applyPetAction(pet, { type: "sleep", hours: 2 }, now);

    expect(sleepResult.ok).toBe(true);
    if (!sleepResult.ok) return;

    const playResult = applyPetAction(
      sleepResult.state,
      { type: "play", minutes: 10 },
      new Date("2026-01-01T01:00:00.000Z"),
    );

    expect(playResult.ok).toBe(false);
    if (playResult.ok) return;

    expect(playResult.error.code).toBe("PET_SLEEPING");
  });

  it("rejects invalid action parameters", () => {
    const pet = createInitialPet("Mochi", now);
    const result = applyPetAction(pet, { type: "feed", amount: 0 }, now);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("INVALID_ACTION");
  });

  it("pets the pet without consuming resources", () => {
    const pet = createInitialPet("Mochi", now);
    const result = applyPetAction(pet, { type: "pet" }, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.mood).toBe(73);
    expect(result.state.energy).toBe(pet.energy);
    expect(result.state.hunger).toBe(pet.hunger);
  });
});
