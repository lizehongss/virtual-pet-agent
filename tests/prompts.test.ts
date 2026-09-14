import { buildPetSystemPrompt } from "../src/agent/prompts";
import { createInitialPet } from "../src/domain/pet";

describe("pet system prompt", () => {
  it("clarifies user and pet pronouns before tool calls", () => {
    const prompt = buildPetSystemPrompt(createInitialPet("Mochi"), {
      allowTools: true,
    });

    expect(prompt).toContain("用户说“我”时，默认指用户本人");
    expect(prompt).toContain("“你”“宠物”“它”默认指当前宠物");
    expect(prompt).toContain("如果人称或动作对象不清晰");
  });
});
