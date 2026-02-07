import Anthropic from "@anthropic-ai/sdk";
import { searchPerson, PersonQuery, SearchResult } from "./tavily.ts";
import { getConversation, saveConversation, startNewSession, acquireProcessingLock, releaseProcessingLock, ConversationData } from "./db.ts";

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

// Conversation state interface
interface ConversationState {
  messages: Anthropic.MessageParam[];
  personInfo: Partial<PersonQuery>;
}

// Tool definition for Claude
const tools: Anthropic.Tool[] = [
  {
    name: "gather_person_info",
    description: "Validate and structure the person details collected so far before searching. Call this BEFORE search_person to confirm you have enough information for an effective web search. Returns a readiness assessment and identifies any missing fields that would improve search quality.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The person's full name (required)"
        },
        company: {
          type: "string",
          description: "The company they work for (if known)"
        },
        role: {
          type: "string",
          description: "Their job title or role (if known)"
        },
        location: {
          type: "string",
          description: "Their location - city, state, or country (if known)"
        },
        additional_context: {
          type: "string",
          description: "Any other details the user shared (e.g. 'met at a conference', 'friend of a friend', industry)"
        }
      },
      required: ["name"]
    }
  },
  {
    name: "search_person",
    description: "Search the web for information about a person, including their professional background, company, recent news, and social profiles. Only call this AFTER using gather_person_info to confirm you have enough details.",
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

// ─── gather_person_info logic ─────────────────────────────────────────────────

interface GatherPersonInfoInput {
  name: string;
  company?: string;
  role?: string;
  location?: string;
  linkedin_url?: string;
  additional_context?: string;
}

interface GatherPersonInfoResult {
  ready_to_search: boolean;
  person: GatherPersonInfoInput;
  quality_score: "high" | "medium" | "low";
  missing_fields: string[];
  suggestion: string;
}

function evaluatePersonInfo(input: GatherPersonInfoInput): GatherPersonInfoResult {
  const missing: string[] = [];
  let qualifierCount = 0;

  // Check which optional fields are present
  if (input.company) qualifierCount++;
  else missing.push("company");

  if (input.role) qualifierCount++;
  else missing.push("role");

  if (input.location) qualifierCount++;
  else missing.push("location");

  if (input.linkedin_url) qualifierCount++;
  if (input.additional_context) qualifierCount++;

  // Determine quality and readiness
  let quality: "high" | "medium" | "low";
  let ready: boolean;
  let suggestion: string;

  if (qualifierCount >= 2) {
    quality = "high";
    ready = true;
    suggestion = "Good to search. You have enough details for a targeted lookup.";
  } else if (qualifierCount === 1) {
    quality = "medium";
    ready = true;
    suggestion = `Searchable, but results would improve with more details. Missing: ${missing.slice(0, 2).join(", ")}. Consider asking the user if they know any of these.`;
  } else {
    quality = "low";
    ready = false;
    suggestion = `Not enough info for a useful search. A name alone is too ambiguous. Ask the user for at least one of: ${missing.join(", ")}.`;
  }

  console.log(`[gather_person_info] Name: ${input.name}, Qualifiers: ${qualifierCount}, Quality: ${quality}, Ready: ${ready}`);

  return {
    ready_to_search: ready,
    person: input,
    quality_score: quality,
    missing_fields: missing,
    suggestion,
  };
}

const SYSTEM_PROMPT = `You are a pre-meeting research assistant that helps users prepare for business meetings via SMS.

When the user provides information about someone they're meeting, follow this workflow:

1. GATHER INFO: Always call gather_person_info first with whatever details you have. This validates whether you have enough to search effectively.

2. CHECK READINESS:
   - If gather_person_info says ready_to_search is false, respond with a brief text asking the user for the missing details. Keep it brief - this is SMS.
   - If gather_person_info says ready_to_search is true but quality is "medium", you may either search now or ask one quick follow-up to improve results. Use your judgment.
   - If quality is "high", proceed to search immediately.

3. SEARCH: Call search_person with the gathered details.

4. REPORT: After getting search results, compile a concise meeting prep report that includes:
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

// Check if this message starts a new conversation
async function isNewConversation(
  newMessage: string,
  existingMessages: Anthropic.MessageParam[]
): Promise<boolean> {
  // No existing conversation = definitely new
  if (existingMessages.length === 0) {
    return false; // No need to clear, nothing exists
  }

  // Check for explicit reset keywords
  const resetKeywords = ["start over", "new search", "reset", "new person", "different person"];
  if (resetKeywords.some(keyword => newMessage.toLowerCase().includes(keyword))) {
    console.log("[isNewConversation] Reset keyword detected");
    return true;
  }

  // Ask Claude to determine if this is a new conversation
  console.log("[isNewConversation] Asking Claude to determine if new conversation...");
  const client = getClient();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 10,
    system: `You determine if a new message is starting a fresh conversation or continuing an existing one.

Respond with only "NEW" or "CONTINUE".

Say "NEW" if:
- The user is asking about a different person than before
- The user seems to be starting a completely new request
- The message doesn't relate to the previous conversation

Say "CONTINUE" if:
- The user is providing additional info about the same person
- The user is answering a question you asked
- The message is a follow-up to the previous conversation`,
    messages: [
      {
        role: "user",
        content: `Previous conversation:\n${summarizeConversation(existingMessages)}\n\nNew message: "${newMessage}"\n\nIs this NEW or CONTINUE?`
      }
    ]
  });

  const answer = response.content[0].type === "text" ? response.content[0].text.trim().toUpperCase() : "";
  console.log("[isNewConversation] Claude says:", answer);
  return answer === "NEW";
}

// Create a brief summary of existing conversation for context check
function summarizeConversation(messages: Anthropic.MessageParam[]): string {
  return messages
    .slice(-4) // Only look at last 4 messages for context
    .map(m => {
      const content = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((b): b is Anthropic.TextBlock => typeof b === 'object' && 'type' in b && b.type === 'text').map(b => b.text).join(" ")
          : "";
      return `${m.role}: ${content.slice(0, 100)}`;
    })
    .join("\n");
}

// Type for the sendSMS function that must be provided
type SendSMSFunction = (phoneNumber: string, message: string) => Promise<void>;

export async function receiveMessage(
  phoneNumber: string,
  msg: string,
  sendSMS: SendSMSFunction
): Promise<void> {
  console.log("[receiveMessage] START - phoneNumber:", phoneNumber, "msg:", msg);

  // Check if already processing a message for this phone number
  const lockAcquired = await acquireProcessingLock(phoneNumber);
  if (!lockAcquired) {
    console.log("[receiveMessage] Already processing for", phoneNumber, "- sending wait message");
    await sendSMS(phoneNumber, "Still working on your previous request, one moment...");
    return;
  }

  try {
    // Get or create conversation state from database
    let conversationData = await getConversation(phoneNumber);
    let state: ConversationState;

    if (!conversationData) {
      console.log("[receiveMessage] Creating new conversation state for", phoneNumber);
      state = { messages: [], personInfo: {} };
    } else {
      console.log("[receiveMessage] Found existing conversation with", conversationData.messages.length, "messages");
      state = {
        messages: conversationData.messages as Anthropic.MessageParam[],
        personInfo: conversationData.personInfo as Partial<PersonQuery>,
      };
    }

    // Check if this is a new conversation
    if (await isNewConversation(msg, state.messages)) {
      console.log("[receiveMessage] New conversation detected, clearing history");
      await startNewSession(phoneNumber);
      state = { messages: [], personInfo: {} };
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

          if (toolUse.name === "gather_person_info") {
            const input = toolUse.input as GatherPersonInfoInput;

            console.log("[receiveMessage] Evaluating person info...");
            const result = evaluatePersonInfo(input);
            console.log("[receiveMessage] gather_person_info result:", JSON.stringify(result));

            // Store the gathered person info in conversation state
            state.personInfo = {
              name: input.name,
              company: input.company,
              role: input.role,
              location: input.location,
              linkedinUrl: input.linkedin_url,
              additionalContext: input.additional_context,
            };

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(result)
            });
          } else if (toolUse.name === "search_person") {
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
          .join("\n")
          .trim();

        console.log("[receiveMessage] Response text length:", responseText.length);
        console.log("[receiveMessage] Response text preview:", responseText.substring(0, 200) + (responseText.length > 200 ? "..." : ""));

        // Add assistant response to history
        state.messages.push({ role: "assistant", content: response.content });

        // Only send SMS if there's actual text content
        // (Claude may have already sent messages via the send_message tool)
        if (responseText.length > 0) {
          console.log("[receiveMessage] Sending SMS response...");
          await sendSMS(phoneNumber, responseText);
          console.log("[receiveMessage] SMS sent successfully");
        } else {
          console.log("[receiveMessage] No text content to send (messages may have been sent via send_message tool)");
        }
      }
    }

    if (loopCount >= maxLoops) {
      console.error("[receiveMessage] Hit max loop limit!");
    }

    // Save conversation state to database
    console.log("[receiveMessage] Saving conversation to database...");
    await saveConversation(phoneNumber, state.messages, state.personInfo);
    console.log("[receiveMessage] Conversation saved");

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
  } finally {
    // Always release the lock
    await releaseProcessingLock(phoneNumber);
  }
}

// Clear conversation history for a phone number (useful for "start over")
export async function clearConversation(phoneNumber: string): Promise<void> {
  await startNewSession(phoneNumber);
}
