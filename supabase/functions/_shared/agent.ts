import Anthropic from "@anthropic-ai/sdk";
import { searchPerson, PersonQuery, SearchResult } from "./tavily.ts";

// Lazy singleton for Anthropic client
let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    console.log("[Anthropic] Initializing client...");
    _client = new Anthropic({ apiKey });
    console.log("[Anthropic] Client initialized successfully");
  }
  return _client;
}

// Store conversation state per phone number
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
  },
  {
    name: "send_message",
    description: "Send an SMS message to the user. Use this to provide updates, ask follow-up questions, or deliver information to the user during the conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "The message text to send to the user"
        }
      },
      required: ["message"]
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

// Convert search results to a string for Claude
function formatSearchResults(results: SearchResult[]): string {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join("\n\n");
}

// Type for the sendSMS function that must be provided
type SendSMSFunction = (phoneNumber: string, message: string) => Promise<void>;

export async function receiveMessage(
  phoneNumber: string,
  msg: string,
  sendSMS: SendSMSFunction
): Promise<void> {
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
      const client = getClient();

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
          } else if (toolUse.name === "send_message") {
            const input = toolUse.input as { message: string };

            try {
              console.log("[receiveMessage] Sending message via send_message tool...");
              console.log("[receiveMessage] Message content:", input.message.substring(0, 100) + (input.message.length > 100 ? "..." : ""));
              await sendSMS(phoneNumber, input.message);
              console.log("[receiveMessage] Message sent successfully");

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: "Message sent successfully"
              });
            } catch (error) {
              console.error("[receiveMessage] send_message error:", error);
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Failed to send message: ${error instanceof Error ? error.message : "Unknown error"}`,
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

// Clear conversation history for a phone number (useful for "start over")
export function clearConversation(phoneNumber: string): void {
  conversations.delete(phoneNumber);
}
