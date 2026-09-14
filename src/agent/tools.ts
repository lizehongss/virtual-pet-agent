import { z } from "zod";
import { applyPetAction } from "../domain/actions";
import type { PetAction, PetEvent, PetState } from "../domain/pet";
import { advanceTime } from "../domain/pet";
import type { LlmToolDefinition } from "./llm-client";

export type ToolName =
  | "get_pet_status"
  | "feed_pet"
  | "play_with_pet"
  | "put_pet_to_sleep"
  | "pet_the_pet";

export type ToolExecutionContext = {
  pet: PetState;
  now: Date;
};

export type ToolExecutionResult = {
  ok: boolean;
  state: PetState;
  message: string;
  toolName: ToolName | null;
  event?: PetEvent;
  error?: string;
};

export const PET_TOOL_DEFINITIONS: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_pet_status",
      description: "查看宠物当前的饥饿度、精力、心情、健康度和睡眠状态。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "feed_pet",
      description: "给宠物喂食，降低饥饿度并提升少量心情。",
      parameters: {
        type: "object",
        properties: {
          amount: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            description: "喂食量，必须是 1 到 100 的整数。",
          },
        },
        required: ["amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "play_with_pet",
      description: "和宠物玩耍，消耗精力、提升心情并增加少量饥饿度。",
      parameters: {
        type: "object",
        properties: {
          minutes: {
            type: "integer",
            minimum: 1,
            maximum: 60,
            description: "玩耍时长，单位为分钟。",
          },
        },
        required: ["minutes"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "put_pet_to_sleep",
      description: "让宠物睡觉，在指定时间内恢复精力。",
      parameters: {
        type: "object",
        properties: {
          hours: {
            type: "integer",
            minimum: 1,
            maximum: 12,
            description: "睡眠时长，单位为小时。",
          },
        },
        required: ["hours"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pet_the_pet",
      description: "抚摸宠物，提升少量心情，不消耗资源。",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

const emptyArgumentsSchema = z.object({}).strict();
const feedArgumentsSchema = z
  .object({ amount: z.number().int().min(1).max(100) })
  .strict();
const playArgumentsSchema = z
  .object({ minutes: z.number().int().min(1).max(60) })
  .strict();
const sleepArgumentsSchema = z
  .object({ hours: z.number().int().min(1).max(12) })
  .strict();

export class PetToolRegistry {
  getDefinitions(): LlmToolDefinition[] {
    return PET_TOOL_DEFINITIONS.map((definition) => ({
      ...definition,
      function: {
        ...definition.function,
        parameters: { ...definition.function.parameters },
      },
    }));
  }

  async execute(
    name: string,
    rawArguments: unknown,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const pet = context.pet;

    switch (name) {
      case "get_pet_status": {
        const state = this.advancePet(context);
        return {
          ok: true,
          state,
          toolName: name,
          message: formatPetStatus(state),
        };
      }
      case "feed_pet": {
        const parsed = feedArgumentsSchema.safeParse(rawArguments);
        if (!parsed.success) {
          return invalidArguments(pet, name, "amount 必须是 1 到 100 的整数。");
        }
        return this.executeAction(
          name,
          { type: "feed", amount: parsed.data.amount },
          context,
        );
      }
      case "play_with_pet": {
        const parsed = playArgumentsSchema.safeParse(rawArguments);
        if (!parsed.success) {
          return invalidArguments(
            pet,
            name,
            "minutes 必须是 1 到 60 的整数。",
          );
        }
        return this.executeAction(
          name,
          { type: "play", minutes: parsed.data.minutes },
          context,
        );
      }
      case "put_pet_to_sleep": {
        const parsed = sleepArgumentsSchema.safeParse(rawArguments);
        if (!parsed.success) {
          return invalidArguments(
            pet,
            name,
            "hours 必须是 1 到 12 的整数。",
          );
        }
        return this.executeAction(
          name,
          { type: "sleep", hours: parsed.data.hours },
          context,
        );
      }
      case "pet_the_pet": {
        const parsed = emptyArgumentsSchema.safeParse(rawArguments);
        if (!parsed.success) {
          return invalidArguments(pet, name, "这个工具不接受额外参数。");
        }
        return this.executeAction(name, { type: "pet" }, context);
      }
      default:
        return {
          ok: false,
          state: this.advancePet(context),
          toolName: null,
          message: "我还不会执行这个动作。",
          error: `Unknown tool: ${name}`,
        };
    }
  }

  private advancePet(context: ToolExecutionContext): PetState {
    return advanceTime(context.pet, context.now);
  }

  private async executeAction(
    toolName: ToolName,
    action: PetAction,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const result = applyPetAction(context.pet, action, context.now);

    if (!result.ok) {
      return {
        ok: false,
        state: result.state,
        toolName,
        message: result.error.message,
        error: result.error.code,
      };
    }

    return {
      ok: true,
      state: result.state,
      toolName,
      event: result.event,
      message: actionSuccessMessage(result.state, toolName),
    };
  }
}

function invalidArguments(
  pet: PetState,
  toolName: ToolName,
  message: string,
): ToolExecutionResult {
  return {
    ok: false,
    state: pet,
    toolName,
    message: `工具参数无效：${message}`,
    error: "INVALID_TOOL_ARGUMENTS",
  };
}

function actionSuccessMessage(pet: PetState, toolName: ToolName): string {
  switch (toolName) {
    case "feed_pet":
      return `${pet.name} 吃完东西后感觉好多了。`;
    case "play_with_pet":
      return `${pet.name} 玩得很开心！`;
    case "put_pet_to_sleep":
      return `${pet.name} 已经开始睡觉了。`;
    case "pet_the_pet":
      return `${pet.name} 开心地蹭了蹭你。`;
    case "get_pet_status":
      return formatPetStatus(pet);
  }
}

function formatPetStatus(pet: PetState): string {
  const sleepStatus = pet.sleepUntil
    ? `正在睡觉，预计 ${pet.sleepUntil} 醒来`
    : "当前清醒";

  return `${pet.name} 当前状态：饥饿度 ${pet.hunger}/100，精力 ${pet.energy}/100，心情 ${pet.mood}/100，健康度 ${pet.health}/100，${sleepStatus}。`;
}
