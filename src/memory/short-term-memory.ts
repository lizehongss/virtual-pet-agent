import type { ChatMessage } from "../agent/llm-client";

/** 单次模型请求最多携带的短期消息数量。 */
export const MAX_SHORT_TERM_CONTEXT_MESSAGES = 10;

/** 当前会话最多保留的消息数量，约等于最近 10 轮对话。 */
export const MAX_SHORT_TERM_STORED_MESSAGES =
  MAX_SHORT_TERM_CONTEXT_MESSAGES * 2;

/**
 * 获取最近的短期记忆，避免会话历史无限增长。
 */
export function getRecentMessages(
  history: ChatMessage[],
  limit = MAX_SHORT_TERM_CONTEXT_MESSAGES,
): ChatMessage[] {
  return history.slice(-limit);
}

/**
 * 把一轮用户输入和宠物回复加入当前会话记忆，并裁剪旧消息。
 */
export function appendShortTermTurn(
  history: ChatMessage[],
  userMessage: string,
  assistantReply: string,
  maxMessages = MAX_SHORT_TERM_STORED_MESSAGES,
): void {
  const userContent = userMessage.trim();
  const assistantContent = assistantReply.trim();

  if (!userContent || !assistantContent) {
    return;
  }

  history.push(
    { role: "user", content: userContent },
    { role: "assistant", content: assistantContent },
  );

  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }
}
