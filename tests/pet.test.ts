import {
  advanceTime,
  createInitialPet,
  isPetSleeping,
} from "../src/domain/pet";

describe("pet state", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");

  it("creates a pet with a healthy initial state", () => {
    const pet = createInitialPet("Mochi", start);

    expect(pet.name).toBe("Mochi");
    expect(pet.hunger).toBe(30);
    expect(pet.energy).toBe(80);
    expect(pet.mood).toBe(70);
    expect(pet.health).toBe(100);
    expect(pet.sleepUntil).toBeNull();
  });

  it("advances hunger and energy as time passes", () => {
    const pet = createInitialPet("Mochi", start);
    const afterTwoHours = advanceTime(
      pet,
      new Date("2026-01-01T02:00:00.000Z"),
    );

    expect(afterTwoHours.hunger).toBe(40);
    expect(afterTwoHours.energy).toBe(76);
    expect(afterTwoHours.updatedAt).toBe("2026-01-01T02:00:00.000Z");
  });

  it("recovers energy while sleeping and wakes up at the end", () => {
    const sleepingPet = {
      ...createInitialPet("Mochi", start),
      energy: 20,
      sleepUntil: "2026-01-01T02:00:00.000Z",
    };

    const awakePet = advanceTime(
      sleepingPet,
      new Date("2026-01-01T02:00:00.000Z"),
    );

    expect(awakePet.energy).toBe(40);
    expect(awakePet.sleepUntil).toBeNull();
    expect(isPetSleeping(awakePet, new Date("2026-01-01T02:00:00.000Z"))).toBe(
      false,
    );
  });

  it("keeps all numeric attributes within 0 and 100", () => {
    const pet = {
      ...createInitialPet("Mochi", start),
      hunger: 99,
      energy: 1,
      mood: 0,
      health: 0,
    };

    const nextPet = advanceTime(
      pet,
      new Date("2026-01-02T00:00:00.000Z"),
    );

    expect(nextPet.hunger).toBeLessThanOrEqual(100);
    expect(nextPet.energy).toBeGreaterThanOrEqual(0);
    expect(nextPet.mood).toBeGreaterThanOrEqual(0);
    expect(nextPet.health).toBeGreaterThanOrEqual(0);
  });
});
