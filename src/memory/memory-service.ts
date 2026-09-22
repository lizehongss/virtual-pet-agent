import { randomUUID } from "node:crypto";
import type {
  MemoryKind,
  MemoryRepository,
  PetMemory,
} from "./memory-repository";

export type MemoryCandidate = {
  kind: MemoryKind;
  content: string;
  keywords: string[];
  importance: number;
};

/**
 * 管理长期记忆的提取、去重、保存和关键词检索。
 *
 * 第一版只从用户明确表达的事实中提取记忆，不让模型自行编造长期记忆。
 */
export class PetMemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  async rememberFromUserMessage(
    petId: string,
    message: string,
    now = new Date(),
  ): Promise<PetMemory[]> {
    const candidates = extractLongTermMemories(message);
    if (candidates.length === 0) {
      return [];
    }

    const existingMemories = await this.repository.listMemories(petId);
    const savedMemories: PetMemory[] = [];

    for (const candidate of candidates) {
      const existing = existingMemories.find(
        (memory) =>
          memory.kind === candidate.kind &&
          normalize(memory.content) === normalize(candidate.content),
      );
      const memory: PetMemory = existing
        ? {
            ...existing,
            keywords: uniqueStrings([...existing.keywords, ...candidate.keywords]),
            importance: Math.max(existing.importance, candidate.importance),
            updatedAt: now.toISOString(),
          }
        : {
            id: randomUUID(),
            petId,
            ...candidate,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          };

      await this.repository.saveMemory(memory);
      savedMemories.push(memory);

      const existingIndex = existingMemories.findIndex(
        (storedMemory) => storedMemory.id === memory.id,
      );
      if (existingIndex >= 0) {
        existingMemories[existingIndex] = memory;
      } else {
        existingMemories.push(memory);
      }
    }

    return savedMemories;
  }

  async getRelevantMemories(
    petId: string,
    query: string,
    limit = 5,
  ): Promise<PetMemory[]> {
    const memories = await this.repository.listMemories(petId);
    const normalizedQuery = normalize(query);

    if (!normalizedQuery) {
      return [];
    }

    return memories
      .map((memory) => ({
        memory,
        score: scoreMemory(memory, normalizedQuery),
      }))
      .filter((item) => item.score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return right.memory.updatedAt.localeCompare(left.memory.updatedAt);
      })
      .slice(0, limit)
      .map((item) => item.memory);
  }
}

export function extractLongTermMemories(
  message: string,
): MemoryCandidate[] {
  const content = message.trim();
  if (!content) {
    return [];
  }

  const candidates: MemoryCandidate[] = [];
  const name = capture(content, /(?:我的名字是|我叫)([^，。！？!?；;\n]{1,20})/);
  const dislike = capture(
    content,
    /我不喜欢([^，。！？!?；;\n]{1,40})/,
  );
  const like = capture(
    content,
    /我(?:最)?喜欢([^，。！？!?；;\n]{1,40})/,
  );

  if (name) {
    candidates.push({
      kind: "identity",
      content: `用户的名字是${name}`,
      keywords: uniqueStrings(["名字", "称呼", name, ...deriveKeywords(name)]),
      importance: 1,
    });
  }

  if (dislike) {
    candidates.push({
      kind: "preference",
      content: `用户不喜欢${dislike}`,
      keywords: uniqueStrings([
        "不喜欢",
        "偏好",
        dislike,
        ...deriveKeywords(dislike),
      ]),
      importance: 0.8,
    });
  }

  if (like) {
    candidates.push({
      kind: "preference",
      content: `用户喜欢${like}`,
      keywords: uniqueStrings(["喜欢", "偏好", like, ...deriveKeywords(like)]),
      importance: 0.8,
    });
  }

  const agreement = capture(
    content,
    /(?:请记住|记住|别忘了|我们约定)(?:是|：|:|，|,)?\s*([^。！？!?；;\n]{1,80})/,
  );
  if (agreement && !name && !like && !dislike) {
    candidates.push({
      kind: "agreement",
      content: agreement,
      keywords: uniqueStrings([
        "记住",
        "约定",
        ...deriveKeywords(agreement),
      ]),
      importance: 0.9,
    });
  }

  return deduplicateCandidates(candidates);
}

function capture(message: string, pattern: RegExp): string | null {
  const match = message.match(pattern);
  if (!match?.[1]) {
    return null;
  }

  const value = match[1]
    .trim()
    .replace(/^[：:，,\s]+/, "")
    .replace(/[，,。；;！？!?]+$/, "");

  return value || null;
}

function scoreMemory(memory: PetMemory, query: string): number {
  let score = 0;
  const recallIntent = /记得|记住|了解我|认识我|关于我|我是谁/.test(query);
  const specificMemoryTopic =
    /名字|称呼|叫什么|喜欢|偏好|爱吃|讨厌|约定|答应|承诺|说过的事/.test(
      query,
    );

  for (const keyword of memory.keywords) {
    const normalizedKeyword = normalize(keyword);
    if (normalizedKeyword && query.includes(normalizedKeyword)) {
      score += normalizedKeyword.length >= 2 ? 3 : 1;
    }
  }

  if (memory.kind === "identity" && /名字|称呼|叫什么/.test(query)) {
    score += 4;
  }
  if (memory.kind === "preference" && /喜欢|偏好|爱吃|讨厌/.test(query)) {
    score += 3;
  }
  if (
    memory.kind === "agreement" &&
    /约定|答应|承诺|说过的事|之前/.test(query)
  ) {
    score += 3;
  }

  if (recallIntent && !specificMemoryTopic) {
    score += Math.max(1, Math.round(memory.importance * 2));
  }

  return score;
}

function deriveKeywords(value: string): string[] {
  const normalized = normalize(value);
  const keywords = new Set<string>();

  for (const word of normalized.match(/[a-z0-9_]+/g) ?? []) {
    keywords.add(word);
  }

  for (const segment of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (segment.length <= 3) {
      keywords.add(segment);
    }

    for (let index = 0; index < segment.length - 1; index += 1) {
      keywords.add(segment.slice(index, index + 2));
    }
  }

  return [...keywords];
}

function deduplicateCandidates(
  candidates: MemoryCandidate[],
): MemoryCandidate[] {
  const unique = new Map<string, MemoryCandidate>();

  for (const candidate of candidates) {
    unique.set(`${candidate.kind}:${normalize(candidate.content)}`, candidate);
  }

  return [...unique.values()];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))];
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}
