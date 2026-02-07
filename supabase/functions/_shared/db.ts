import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Lazy singleton for Supabase client
let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!url || !serviceKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }

    _supabase = createClient(url, serviceKey);
  }
  return _supabase;
}

// Types matching the database schema
interface User {
  id: string;
  phone_number: string;
  created_at: string;
}

interface Session {
  id: string;
  user_id: string;
  subject_name: string | null;
  subject_info: Record<string, unknown>;
  status: "active" | "completed" | "abandoned";
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  session_id: string;
  direction: "inbound" | "outbound";
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

// Conversation state (matches the interface expected by agent.ts)
export interface ConversationData {
  userId: string;
  sessionId: string;
  messages: Array<{ role: string; content: unknown }>;
  personInfo: Record<string, unknown>;
}

// Get or create user by phone number
async function getOrCreateUser(phoneNumber: string): Promise<User> {
  const supabase = getSupabase();

  // Try to get existing user
  const { data: existingUser, error: selectError } = await supabase
    .from("users")
    .select("*")
    .eq("phone_number", phoneNumber)
    .single();

  if (existingUser) {
    return existingUser;
  }

  // Create new user if not found
  const { data: newUser, error: insertError } = await supabase
    .from("users")
    .insert({ phone_number: phoneNumber })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to create user: ${insertError.message}`);
  }

  return newUser;
}

// Get active session for user, or create new one
async function getOrCreateActiveSession(userId: string): Promise<Session> {
  const supabase = getSupabase();

  // Try to get existing active session
  const { data: existingSession } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existingSession) {
    return existingSession;
  }

  // Create new session
  const { data: newSession, error: insertError } = await supabase
    .from("sessions")
    .insert({ user_id: userId, status: "active" })
    .select()
    .single();

  if (insertError) {
    throw new Error(`Failed to create session: ${insertError.message}`);
  }

  return newSession;
}

// Get messages for a session
async function getSessionMessages(sessionId: string): Promise<Message[]> {
  const supabase = getSupabase();

  const { data: messages, error } = await supabase
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to get messages: ${error.message}`);
  }

  return messages || [];
}

// Get conversation by phone number (maintains same interface as before)
export async function getConversation(phoneNumber: string): Promise<ConversationData | null> {
  try {
    const user = await getOrCreateUser(phoneNumber);
    const session = await getOrCreateActiveSession(user.id);
    const messages = await getSessionMessages(session.id);

    // Convert messages to the format expected by agent.ts
    const formattedMessages = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    return {
      userId: user.id,
      sessionId: session.id,
      messages: formattedMessages,
      personInfo: session.subject_info || {},
    };
  } catch (error) {
    console.error("[db] getConversation error:", error);
    return null;
  }
}

// Save conversation (maintains same interface as before)
export async function saveConversation(
  phoneNumber: string,
  messages: Array<{ role: string; content: unknown }>,
  personInfo: Record<string, unknown> = {}
): Promise<void> {
  const supabase = getSupabase();

  const user = await getOrCreateUser(phoneNumber);
  const session = await getOrCreateActiveSession(user.id);

  // Update session with person info
  if (Object.keys(personInfo).length > 0) {
    const { error: updateError } = await supabase
      .from("sessions")
      .update({
        subject_info: personInfo,
        subject_name: personInfo.name as string || null
      })
      .eq("id", session.id);

    if (updateError) {
      console.error("[db] Failed to update session:", updateError);
    }
  }

  // Get existing messages to determine what's new
  const existingMessages = await getSessionMessages(session.id);
  const existingCount = existingMessages.length;

  // Only insert new messages (those beyond existing count)
  const newMessages = messages.slice(existingCount);

  if (newMessages.length > 0) {
    const messagesToInsert = newMessages.map((msg) => ({
      session_id: session.id,
      role: msg.role,
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
      direction: msg.role === "user" ? "inbound" : "outbound",
    }));

    const { error: insertError } = await supabase
      .from("messages")
      .insert(messagesToInsert);

    if (insertError) {
      console.error("[db] Failed to insert messages:", insertError);
    }
  }
}

// Delete/clear conversation (marks session as completed and creates new one)
export async function deleteConversation(phoneNumber: string): Promise<void> {
  const supabase = getSupabase();

  try {
    const user = await getOrCreateUser(phoneNumber);

    // Mark all active sessions as abandoned
    const { error } = await supabase
      .from("sessions")
      .update({ status: "abandoned" })
      .eq("user_id", user.id)
      .eq("status", "active");

    if (error) {
      console.error("[db] Failed to abandon sessions:", error);
    }
  } catch (error) {
    console.error("[db] deleteConversation error:", error);
  }
}

// Start a new session for a user (used when starting a new research topic)
export async function startNewSession(phoneNumber: string): Promise<ConversationData> {
  const supabase = getSupabase();

  const user = await getOrCreateUser(phoneNumber);

  // Mark any existing active sessions as completed
  await supabase
    .from("sessions")
    .update({ status: "completed" })
    .eq("user_id", user.id)
    .eq("status", "active");

  // Create new session
  const { data: newSession, error } = await supabase
    .from("sessions")
    .insert({ user_id: user.id, status: "active" })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create new session: ${error.message}`);
  }

  return {
    userId: user.id,
    sessionId: newSession.id,
    messages: [],
    personInfo: {},
  };
}
