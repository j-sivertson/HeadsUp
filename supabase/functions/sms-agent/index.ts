// SMS Agent Edge Function
// Receives webhooks from Surge API and processes incoming SMS messages
// Deploy with: supabase functions deploy sms-agent

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Anthropic from "@anthropic-ai/sdk";
import { tavily, TavilyClient } from "@tavily/core";

// Environment variables
const SURGE_API_TOKEN = Deno.env.get("SURGE_API_TOKEN") || Deno.env.get("SURGE_API_KEY")!;
const SURGE_ACCOUNT_ID = Deno.env.get("SURGE_ACCOUNT_ID")!;
const SURGE_PHONE_NUMBER = Deno.env.get("SURGE_PHONE_NUMBER")!;
const SURGE_SIGNING_SECRET = Deno.env.get("SURGE_SIGNING_SECRET");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const TAVILY_API_KEY = Deno.env.get("TAVILY_API_KEY")!;

// Log environment variable status at startup
console.log("=== ENVIRONMENT CHECK ===");
console.log(`SURGE_API_TOKEN: ${SURGE_API_TOKEN ? "SET" : "MISSING"}`);
console.log(`SURGE_ACCOUNT_ID: ${SURGE_ACCOUNT_ID ? "SET" : "MISSING"}`);
console.log(`SURGE_PHONE_NUMBER: ${SURGE_PHONE_NUMBER ? "SET" : "MISSING"}`);
console.log(`SURGE_SIGNING_SECRET: ${SURGE_SIGNING_SECRET ? "SET" : "MISSING"}`);
console.log(`ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY ? "SET (length: " + ANTHROPIC_API_KEY.length + ")" : "MISSING"}`);
console.log(`TAVILY_API_KEY: ${TAVILY_API_KEY ? "SET (length: " + TAVILY_API_KEY.length + ")" : "MISSING"}`);
console.log("=========================");

// Initialize clients lazily to avoid startup errors
let _anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropicClient) {
    console.log("[Anthropic] Initializing client...");
    if (!ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    _anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    console.log("[Anthropic] Client initialized successfully");
  }
  return _anthropicClient;
}

// Lazy Tavily client
let _tavilyClient: TavilyClient | null = null;
function getTavilyClient(): TavilyClient {
  if (!_tavilyClient) {
    console.log("[Tavily] Initializing client...");
    if (!TAVILY_API_KEY) {
      throw new Error("TAVILY_API_KEY is not set");
    }
    _tavilyClient = tavily({ apiKey: TAVILY_API_KEY });
    console.log("[Tavily] Client initialized successfully");
  }
  return _tavilyClient;
}

// Types for person search
interface PersonQuery {
  name: string;
  company?: string;
  role?: string;
  location?: string;
}

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

// Conversation state per phone number
interface ConversationState {
  messages: Anthropic.MessageParam[];
  personInfo: Partial<PersonQuery>;
}

const conversations = new Map<string, ConversationState>();

// Tool definition for Claude
const tools: Anthropic.Tool[] = [
  {
    name: "search_person",
    description: "Search the web for information about a person, including their professional background, company, recent news, and social profiles.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The person's full name"
        },
        company: {
          type: "string",
          description: "The company they work for"
        },
        role: {
          type: "string",
          description: "Their job title or role"
        },
        location: {
          type: "string",
          description: "Their location (city, state, country)"
        }
      },
      required: ["name"]
    }
  }
];

const SYSTEM_PROMPT = `You are a pre-meeting research assistant that helps users prepare for business meetings via SMS.

When the user provides information about someone they're meeting:

1. If they only provide a name with no other context, ask if they know the company, job title, or location. Keep it brief - this is SMS.

2. If they provide enough details (name + company or other info), OR if they say they don't have more info, use the search_person tool to research them.

3. After gathering information, compile a concise meeting prep report that includes:
   - Professional background summary
   - Current role and company overview
   - Recent news or notable achievements
   - 2-3 suggested talking points

Keep all responses SMS-friendly - concise and to the point. No markdown formatting.`;

// Build search query from person details
function buildSearchQuery(person: PersonQuery): string {
  const parts: string[] = [person.name];
  if (person.role) parts.push(person.role);
  if (person.company) parts.push(person.company);
  if (person.location) parts.push(person.location);
  return parts.join(" ");
}

// Search for a person using Tavily
async function searchPerson(person: PersonQuery): Promise<SearchResult[]> {
  const query = buildSearchQuery(person);
  console.log("[searchPerson] Built query:", query);

  try {
    console.log("[searchPerson] Calling Tavily API...");
    const response = await getTavilyClient().search(query, {
      maxResults: 10,
      searchDepth: "advanced",
      includeAnswer: true,
    });
    console.log("[searchPerson] Tavily returned", response.results?.length || 0, "results");

    const results: SearchResult[] = response.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
    }));

    // If Tavily provided an answer summary, include it as the first result
    if (response.answer) {
      console.log("[searchPerson] Tavily provided answer summary");
      results.unshift({
        title: "Tavily Summary",
        url: "",
        content: response.answer,
      });
    }

    console.log("[searchPerson] Returning", results.length, "total results");
    return results;
  } catch (error) {
    console.error("[searchPerson] Tavily API error:", error);
    throw error;
  }
}

// Format search results for Claude
function formatSearchResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join("\n\n");
}

// Process incoming message with Claude agentic loop
async function receiveMessage(phoneNumber: string, msg: string): Promise<void> {
  console.log("[receiveMessage] START - phoneNumber:", phoneNumber, "msg:", msg);

  try {
    // Get or create conversation state
    let state = conversations.get(phoneNumber);
    if (!state) {
      console.log("[receiveMessage] Creating new conversation state for", phoneNumber);
      state = { messages: [], personInfo: {} };
      conversations.set(phoneNumber, state);
    } else {
      console.log("[receiveMessage] Found existing conversation with", state.messages.length, "messages");
    }

    // Add user message to history
    state.messages.push({ role: "user", content: msg });
    console.log("[receiveMessage] Added user message, total messages:", state.messages.length);

    // Agentic loop
    let continueLoop = true;
    let loopCount = 0;
    const maxLoops = 10; // Safety limit

    while (continueLoop && loopCount < maxLoops) {
      loopCount++;
      console.log("[receiveMessage] Agentic loop iteration", loopCount);

      console.log("[receiveMessage] Calling Claude API...");
      const client = getAnthropicClient();

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools,
        messages: state.messages,
      });

      console.log("[receiveMessage] Claude response received");
      console.log("[receiveMessage] Stop reason:", response.stop_reason);
      console.log("[receiveMessage] Content blocks:", response.content.length);
      console.log("[receiveMessage] Usage - input:", response.usage?.input_tokens, "output:", response.usage?.output_tokens);

      // Check if Claude wants to use a tool
      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );
        console.log("[receiveMessage] Tool use requested:", toolUseBlocks.length, "tools");

        // Add Claude's response to messages
        state.messages.push({ role: "assistant", content: response.content });

        // Process each tool call
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          console.log("[receiveMessage] Processing tool:", toolUse.name, "id:", toolUse.id);
          console.log("[receiveMessage] Tool input:", JSON.stringify(toolUse.input));

          if (toolUse.name === "search_person") {
            const input = toolUse.input as PersonQuery;

            try {
              console.log("[receiveMessage] Calling searchPerson...");
              const searchResults = await searchPerson({
                name: input.name,
                company: input.company,
                role: input.role,
                location: input.location,
              });
              console.log("[receiveMessage] searchPerson returned", searchResults.length, "results");

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: formatSearchResults(searchResults)
              });
            } catch (error) {
              console.error("[receiveMessage] searchPerson error:", error);
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                is_error: true
              });
            }
          } else {
            console.warn("[receiveMessage] Unknown tool requested:", toolUse.name);
          }
        }

        // Add tool results to messages
        state.messages.push({ role: "user", content: toolResults });
        console.log("[receiveMessage] Added tool results to messages");

      } else {
        // Claude gave a final text response
        continueLoop = false;
        console.log("[receiveMessage] Final response from Claude (stop_reason:", response.stop_reason + ")");

        const responseText = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map(block => block.text)
          .join("\n");

        console.log("[receiveMessage] Response text length:", responseText.length);
        console.log("[receiveMessage] Response text preview:", responseText.substring(0, 200) + (responseText.length > 200 ? "..." : ""));

        // Add assistant response to history
        state.messages.push({ role: "assistant", content: response.content });

        // Send the response to the user
        console.log("[receiveMessage] Sending SMS response...");
        await sendSMS(phoneNumber, responseText);
        console.log("[receiveMessage] SMS sent successfully");
      }
    }

    if (loopCount >= maxLoops) {
      console.error("[receiveMessage] Hit max loop limit!");
    }

    console.log("[receiveMessage] END - completed successfully");
  } catch (error) {
    console.error("[receiveMessage] FATAL ERROR:", error);
    console.error("[receiveMessage] Error name:", error instanceof Error ? error.name : "unknown");
    console.error("[receiveMessage] Error message:", error instanceof Error ? error.message : String(error));
    console.error("[receiveMessage] Error stack:", error instanceof Error ? error.stack : "no stack");

    try {
      await sendSMS(phoneNumber, "Sorry, something went wrong. Please try again.");
      console.log("[receiveMessage] Error SMS sent to user");
    } catch (smsError) {
      console.error("[receiveMessage] Failed to send error SMS:", smsError);
    }
  }
}

// Types for Surge webhook payload
interface SurgeWebhookPayload {
  type: string;
  id: string;
  data: {
    id: string;
    body: string;
    conversation: {
      id: string;
      contact: {
        id: string;
        first_name?: string;
        last_name?: string;
        phone_number: string;
      };
      phone_number: string;
    };
    attachments: Array<{ id: string; type: string; url: string }>;
    metadata: Record<string, string>;
  };
}

// Validate Surge webhook signature using HMAC-SHA256
async function validateWebhookSignature(
  signatureHeader: string,
  rawBody: string,
  toleranceSeconds = 300
): Promise<boolean> {
  if (!SURGE_SIGNING_SECRET) {
    console.warn("SURGE_SIGNING_SECRET not set - skipping signature validation");
    return true; // Skip validation if secret not configured
  }

  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) {
    console.error("Invalid signature header format");
    return false;
  }

  // Check timestamp is within tolerance (prevent replay attacks)
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > toleranceSeconds) {
    console.error("Webhook timestamp outside tolerance window");
    return false;
  }

  // Compute HMAC-SHA256 using Web Crypto API
  const encoder = new TextEncoder();
  const keyData = encoder.encode(SURGE_SIGNING_SECRET);
  const signedPayload = encoder.encode(`${timestamp}.${rawBody}`);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", key, signedPayload);
  const expectedSignature = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return signatures.some((sig) => sig === expectedSignature);
}

// Send SMS via Surge API
async function sendSMS(to: string, message: string): Promise<void> {
  console.log("=== SENDING SMS ===");
  console.log(`[sendSMS] To: ${to}`);
  console.log(`[sendSMS] Message length: ${message.length}`);
  console.log(`[sendSMS] Message: ${message}`);
  console.log(`[sendSMS] SURGE_ACCOUNT_ID: ${SURGE_ACCOUNT_ID ? "SET" : "MISSING"}`);
  console.log(`[sendSMS] SURGE_API_TOKEN: ${SURGE_API_TOKEN ? "SET" : "MISSING"}`);

  const url = `https://api.surge.app/accounts/${SURGE_ACCOUNT_ID}/messages`;
  console.log(`[sendSMS] URL: ${url}`);

  const requestBody = {
    body: message,
    conversation: {
      contact: {
        phone_number: to,
      },
    },
  };
  console.log(`[sendSMS] Request body:`, JSON.stringify(requestBody));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SURGE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`[sendSMS] Response status: ${response.status} ${response.statusText}`);

    const responseText = await response.text();
    console.log(`[sendSMS] Response body: ${responseText}`);

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errorJson = JSON.parse(responseText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        // Response wasn't JSON
      }
      throw new Error(`Failed to send SMS: ${errorMessage}`);
    }

    const result = JSON.parse(responseText);
    console.log("[sendSMS] SMS sent successfully, id:", result.id);
    console.log("====================");
  } catch (error) {
    console.error("[sendSMS] Error:", error);
    throw error;
  }
}

serve(async (req) => {
  // Log incoming request
  console.log("=== INCOMING WEBHOOK ===");
  console.log(`Method: ${req.method}`);
  console.log(`URL: ${req.url}`);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, surge-signature",
      },
    });
  }

  try {
    // Get raw body for signature validation
    const rawBody = await req.text();
    console.log("Raw body:", rawBody);

    // Validate webhook signature
    const signatureHeader = req.headers.get("Surge-Signature");
    if (signatureHeader) {
      const isValid = await validateWebhookSignature(signatureHeader, rawBody);
      if (!isValid) {
        console.error("Invalid webhook signature");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      console.log("Webhook signature validated");
    } else {
      console.warn("No Surge-Signature header present");
    }

    // Parse webhook payload
    const payload: SurgeWebhookPayload = JSON.parse(rawBody);
    console.log("Event type:", payload.type);
    console.log("Event ID:", payload.id);

    // Only process message.received events
    if (payload.type !== "message.received") {
      console.log(`Skipping event type: ${payload.type}`);
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract message details
    const messageBody = payload.data.body;
    const senderPhone = payload.data.conversation.contact.phone_number;
    const conversationId = payload.data.conversation.id;
    const contactName = [
      payload.data.conversation.contact.first_name,
      payload.data.conversation.contact.last_name,
    ]
      .filter(Boolean)
      .join(" ") || "Unknown";

    console.log("=== MESSAGE RECEIVED ===");
    console.log(`From: ${senderPhone} (${contactName})`);
    console.log(`Conversation ID: ${conversationId}`);
    console.log(`Message: ${messageBody}`);
    console.log("========================");

    // Process the message with the Claude agent
    await receiveMessage(senderPhone, messageBody);

    return new Response(
      JSON.stringify({
        success: true,
        received: {
          from: senderPhone,
          message: messageBody,
          conversationId: conversationId,
        },
      }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing webhook:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
