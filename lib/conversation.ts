import { PersonQuery } from "./tavily";
import { MessageEntry } from "./anthropic";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConversationState = "gathering_info" | "researching" | "complete";

export interface Conversation {
  /** Sender's phone number (E.164) — used as the key */
  phoneNumber: string;
  /** Sender's name if available */
  contactName?: string;
  /** Current state of the conversation */
  state: ConversationState;
  /** Accumulated person details to research */
  personQuery: PersonQuery;
  /** Full message history for context */
  messages: MessageEntry[];
  /** When the conversation was created */
  createdAt: Date;
  /** When the conversation was last updated */
  updatedAt: Date;
}

// ─── In-Memory Store ─────────────────────────────────────────────────────────

/**
 * In-memory conversation store keyed by phone number.
 *
 * NOTE: This is fine for an MVP. In production, replace with a database
 * (e.g., Redis, PostgreSQL, DynamoDB) for persistence across deploys/restarts.
 */
const conversations = new Map<string, Conversation>();

// Auto-expire conversations after 30 minutes of inactivity
const CONVERSATION_TTL_MS = 30 * 60 * 1000;

/**
 * Get or create a conversation for a given phone number.
 */
export function getOrCreateConversation(
  phoneNumber: string,
  contactName?: string
): Conversation {
  const existing = conversations.get(phoneNumber);

  // If there's an existing conversation that hasn't expired, return it
  if (existing) {
    const age = Date.now() - existing.updatedAt.getTime();
    if (age < CONVERSATION_TTL_MS && existing.state !== "complete") {
      return existing;
    }
    // Expired or complete — start fresh
    conversations.delete(phoneNumber);
  }

  const conversation: Conversation = {
    phoneNumber,
    contactName,
    state: "gathering_info",
    personQuery: { name: "" },
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  conversations.set(phoneNumber, conversation);
  return conversation;
}

/**
 * Update the conversation state and person query.
 */
export function updateConversation(
  phoneNumber: string,
  updates: Partial<Pick<Conversation, "state" | "personQuery">>
): Conversation | null {
  const conversation = conversations.get(phoneNumber);
  if (!conversation) return null;

  if (updates.state) conversation.state = updates.state;
  if (updates.personQuery) {
    conversation.personQuery = {
      ...conversation.personQuery,
      ...updates.personQuery,
    };
  }
  conversation.updatedAt = new Date();

  return conversation;
}

/**
 * Add a message to the conversation history.
 */
export function addMessage(
  phoneNumber: string,
  role: "user" | "assistant",
  content: string
): void {
  const conversation = conversations.get(phoneNumber);
  if (!conversation) return;

  conversation.messages.push({ role, content });
  conversation.updatedAt = new Date();
}

/**
 * Mark a conversation as complete.
 */
export function completeConversation(phoneNumber: string): void {
  const conversation = conversations.get(phoneNumber);
  if (!conversation) return;

  conversation.state = "complete";
  conversation.updatedAt = new Date();
}

/**
 * Get all active conversations (for debugging/monitoring).
 */
export function getActiveConversations(): Conversation[] {
  return Array.from(conversations.values()).filter(
    (c) => c.state !== "complete"
  );
}

/**
 * Clean up expired conversations (call periodically if needed).
 */
export function cleanupExpired(): number {
  let cleaned = 0;
  const now = Date.now();

  for (const [phone, conv] of conversations.entries()) {
    if (now - conv.updatedAt.getTime() > CONVERSATION_TTL_MS) {
      conversations.delete(phone);
      cleaned++;
    }
  }

  return cleaned;
}
