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

// Initialize clients
const anthropicClient = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Lazy Tavily client
let _tavilyClient: TavilyClient | null = null;
function getTavilyClient(): TavilyClient {
  if (!_tavilyClient) {
    _tavilyClient = tavily({ apiKey: TAVILY_API_KEY });
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

  const response = await getTavilyClient().search(query, {
    maxResults: 10,
    searchDepth: "advanced",
    includeAnswer: true,
  });

  const results: SearchResult[] = response.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));

  // If Tavily provided an answer summary, include it as the first result
  if (response.answer) {
    results.unshift({
      title: "Tavily Summary",
      url: "",
      content: response.answer,
    });
  }

  return results;
}

// Format search results for Claude
function formatSearchResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join("\n\n");
}

// Process incoming message with Claude agentic loop
async function receiveMessage(phoneNumber: string, msg: string): Promise<void> {
  try {
    // Get or create conversation state
    let state = conversations.get(phoneNumber);
    if (!state) {
      state = { messages: [], personInfo: {} };
      conversations.set(phoneNumber, state);
    }

    // Add user message to history
    state.messages.push({ role: "user", content: msg });

    // Agentic loop
    let continueLoop = true;

    while (continueLoop) {
      const response = await anthropicClient.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools,
        messages: state.messages,
      });

      // Check if Claude wants to use a tool
      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        // Add Claude's response to messages
        state.messages.push({ role: "assistant", content: response.content });

        // Process each tool call
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          if (toolUse.name === "search_person") {
            const input = toolUse.input as PersonQuery;

            try {
              const searchResults = await searchPerson({
                name: input.name,
                company: input.company,
                role: input.role,
                location: input.location,
              });

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: formatSearchResults(searchResults)
              });
            } catch (error) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Search failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                is_error: true
              });
            }
          }
        }

        // Add tool results to messages
        state.messages.push({ role: "user", content: toolResults });

      } else {
        // Claude gave a final text response
        continueLoop = false;

        const responseText = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map(block => block.text)
          .join("\n");

        // Add assistant response to history
        state.messages.push({ role: "assistant", content: response.content });

        // Send the response to the user
        await sendSMS(phoneNumber, responseText);
      }
    }
  } catch (error) {
    console.error("Error in receiveMessage:", error);
    await sendSMS(phoneNumber, "Sorry, something went wrong. Please try again.");
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
  console.log(`To: ${to}`);
  console.log(`Message: ${message}`);

  const response = await fetch(
    `https://api.surge.app/accounts/${SURGE_ACCOUNT_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SURGE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        body: message,
        conversation: {
          contact: {
            phone_number: to,
          },
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to send SMS: ${error.error?.message || response.statusText}`);
  }

  const result = await response.json();
  console.log("SMS sent successfully:", result.id);
  console.log("====================");
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
