// lib/agent.ts

import Anthropic from "@anthropic-ai/sdk";
import { searchPerson, PersonQuery, SearchResult } from "@/lib/tavily";
// Your teammate implements this
import { sendMessage } from "@/lib/sms";

const client = new Anthropic();

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

export async function receiveMessage(phoneNumber: string, msg: string): Promise<void> {
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
            const response = await client.messages.create({
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
                await sendMessage(phoneNumber, responseText);
            }
        }
    } catch (error) {
        console.error("Error in receiveMessage:", error);
        await sendMessage(phoneNumber, "Sorry, something went wrong. Please try again.");
    }
}

// Clear conversation history for a phone number (useful for "start over")
export function clearConversation(phoneNumber: string): void {
    conversations.delete(phoneNumber);
}
