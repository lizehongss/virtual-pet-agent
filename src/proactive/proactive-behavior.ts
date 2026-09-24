import { randomUUID } from "node:crypto";
import type { LlmClient } from "../agent/llm-client";
import { devLog } from "../agent/debug";
import { buildProactiveSystemPrompt } from "../agent/prompts";
import type { PetState } from "../domain/pet";
import {
  PROACTIVE_RULE_IDS,
  ProactiveNotification,
  ProactivePetState,
  ProactiveRepository,
  ProactiveRuleId,
} from "./proactive-repository";

const HOUR_IN_MS = 60 * 60 * 1000;

export const PROACTIVE_RULES: ReadonlyArray<{
  id: ProactiveRuleId;
  cooldownMs: number;
  reason: string;
  shouldTrigger: (pet: PetState, lastInteractionAt: string, now: Date) => boolean;
}> = [
  {
    id: "hunger_high",
    cooldownMs: 6 * HOUR_IN_MS,
    reason: "饥饿度已经达到 80 或以上",
    shouldTrigger: (pet) => pet.hunger >= 80,
  },
  {
    id: "energy_low",
    cooldownMs: 6 * HOUR_IN_MS,
    reason: "精力已经降到 20 或以下",
    shouldTrigger: (pet) => pet.energy <= 20,
  },
  {
    id: "inactivity",
    cooldownMs: 12 * HOUR_IN_MS,
    reason: "已经超过 4 小时没有和用户互动",
    shouldTrigger: (_pet, lastInteractionAt, now) => {
      const lastInteractionTime = new Date(lastInteractionAt).getTime();
      return (
        !Number.isNaN(lastInteractionTime) &&
        now.getTime() - lastInteractionTime >= 4 * HOUR_IN_MS
      );
    },
  },
];

export type ProactiveTrigger = {
  ruleId: ProactiveRuleId;
  reason: string;
  cooldownMs: number;
  triggeredAt: string;
};

export type ProactiveMessageContext = {
  pet: PetState;
  trigger: ProactiveTrigger;
  now: Date;
};

export interface ProactiveMessageGenerator {
  generate(context: ProactiveMessageContext): Promise<string>;
}

export class RuleBasedProactiveMessageGenerator
  implements ProactiveMessageGenerator
{
  async generate({ trigger }: ProactiveMessageContext): Promise<string> {
    switch (trigger.ruleId) {
      case "hunger_high":
        return "我有点饿了，可以陪我吃点东西吗？";
      case "energy_low":
        return "我有点困了，想休息一会儿。";
      case "inactivity":
        return "好久没见到你了，我有点想你。";
      default:
        return "我想和你互动一下。";
    }
  }
}

export class LlmProactiveMessageGenerator
  implements ProactiveMessageGenerator
{
  private readonly fallback = new RuleBasedProactiveMessageGenerator();

  constructor(
    private readonly llmClient: LlmClient,
    private readonly debug = false,
  ) {}

  async generate(context: ProactiveMessageContext): Promise<string> {
    try {
      const reply = (
        await this.llmClient.generateText({
          system: buildProactiveSystemPrompt(
            context.pet,
            context.trigger.reason,
          ),
          messages: [
            {
              role: "user",
              content: "请生成这一条主动提醒。",
            },
          ],
        })
      ).trim();

      if (!reply) {
        throw new Error("LLM returned an empty proactive message");
      }

      return reply;
    } catch (error) {
      devLog(
        "proactive",
        "message generation failed, using fallback",
        { error: error instanceof Error ? error.message : "Unknown error" },
        this.debug,
      );
      return this.fallback.generate(context);
    }
  }
}

export type ProactiveBehaviorOptions = {
  debug?: boolean;
  onNotification?: (
    notification: ProactiveNotification,
  ) => Promise<void> | void;
};

/** 根据确定性规则判断是否提醒，再交给消息生成器表达。 */
export class ProactiveBehaviorService {
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repository: ProactiveRepository,
    private readonly messageGenerator: ProactiveMessageGenerator =
      new RuleBasedProactiveMessageGenerator(),
    private readonly options: ProactiveBehaviorOptions = {},
  ) {}

  async initialize(pet: PetState): Promise<void> {
    await this.runExclusive(async () => {
      const state = await this.getOrCreateState(pet.id, pet.updatedAt);
      await this.repository.saveState(pet.id, state);
    });
  }

  async recordInteraction(
    petId: string,
    at = new Date(),
  ): Promise<void> {
    await this.runExclusive(async () => {
      const state = await this.getOrCreateState(petId, at.toISOString());
      state.lastInteractionAt = at.toISOString();
      await this.repository.saveState(petId, state);
    });
  }

  async check(
    pet: PetState,
    now = new Date(),
  ): Promise<ProactiveNotification[]> {
    return this.runExclusive(async () => {
      const state = await this.getOrCreateState(pet.id, pet.updatedAt);
      const notifications = await this.repository.getNotifications(pet.id);
      const created: ProactiveNotification[] = [];

      for (const rule of PROACTIVE_RULES) {
        if (!rule.shouldTrigger(pet, state.lastInteractionAt, now)) {
          continue;
        }

        const lastNotification = notifications
          .filter((notification) => notification.ruleId === rule.id)
          .at(-1);
        const lastTriggeredAt = lastNotification?.triggeredAt ??
          state.lastTriggeredAt[rule.id];

        if (
          lastTriggeredAt &&
          now.getTime() - new Date(lastTriggeredAt).getTime() < rule.cooldownMs
        ) {
          continue;
        }

        const trigger: ProactiveTrigger = {
          ruleId: rule.id,
          reason: rule.reason,
          cooldownMs: rule.cooldownMs,
          triggeredAt: now.toISOString(),
        };

        devLog(
          "proactive",
          "rule triggered",
          { petId: pet.id, ...trigger },
          this.options.debug ?? false,
        );

        const notification: ProactiveNotification = {
          id: randomUUID(),
          petId: pet.id,
          ruleId: trigger.ruleId,
          reason: trigger.reason,
          triggeredAt: trigger.triggeredAt,
          message: await this.messageGenerator.generate({
            pet,
            trigger,
            now,
          }),
        };

        await this.repository.appendNotification(notification);
        notifications.push(notification);
        state.lastTriggeredAt[rule.id] = trigger.triggeredAt;
        await this.repository.saveState(pet.id, state);
        created.push(notification);

        devLog(
          "proactive",
          "notification dispatched",
          notification,
          this.options.debug ?? false,
        );

        try {
          await this.options.onNotification?.(notification);
        } catch (error) {
          devLog(
            "proactive",
            "notification handler failed",
            { error: error instanceof Error ? error.message : "Unknown error" },
            this.options.debug ?? false,
          );
        }
      }

      return created;
    });
  }

  private async getOrCreateState(
    petId: string,
    fallbackInteractionAt: string,
  ): Promise<ProactivePetState> {
    const existing = await this.repository.getState(petId);
    if (existing) {
      return existing;
    }

    return {
      lastInteractionAt: fallbackInteractionAt,
      lastTriggeredAt: {},
    };
  }

  private async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const next = this.operation.then(task, task);
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export function isProactiveRuleId(value: string): value is ProactiveRuleId {
  return (PROACTIVE_RULE_IDS as readonly string[]).includes(value);
}
