import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
// Your teammate will implement this function
import { searchPerson } from "@/lib/tavily";

const client = new Anthropic();

// Tool definition for Claude
const tools: Anthropic.Tool[] = [
    {
        name: "search_person",
        description: "Search the web for information about a person, including their professional background, company, recent news, and social profiles. Use this to gather information for the meeting prep report.",
        input_schema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "The search query. Should include the person's name and optionally their company, job title, or location for better results."
                }
            },
            required: ["query"]
        }
    }
];

const SYSTEM_PROMPT = `You are a pre-meeting research assistant. Your job is to help users prepare for business meetings by researching the person they're meeting with.

When the user provides information about someone they're meeting:

1. If they only provide a name with no other context, ask if they know the company, job title, or location. Be concise - one short question.

2. If they provide a name and company (or other helpful details), OR if they indicate they don't have more information, use the search_person tool to research them. Make multiple searches if needed to gather comprehensive information.

3. After gathering information, compile a concise meeting prep report that includes:
   - Professional background summary
   - Current role and company overview
   - Recent news or notable achievements
   - Suggested talking points for the meeting
   - Potential common ground or conversation starters

Keep your communication brief and professional.`;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const {
            personName,
            company,
            jobTitle,
            location,
            conversationHistory = []
        } = body;

        if (!personName) {
            return NextResponse.json(
                { error: "personName is required" },
                { status: 400 }
            );
        }

        // Build the initial message with whatever info we have
        let userMessage = `I have a meeting with ${personName}`;
        if (company) userMessage += ` from ${company}`;
        if (jobTitle) userMessage += `, they are a ${jobTitle}`;
        if (location) userMessage += ` in ${location}`;
        userMessage += ". Please research them and prepare a meeting brief for me.";

        // Build messages array - include history if this is a follow-up
        const messages: Anthropic.MessageParam[] = [
            ...conversationHistory,
            { role: "user", content: userMessage }
        ];

        // Agentic loop - keep going until Claude gives a final text response
        let continueLoop = true;

        while (continueLoop) {
            const response = await client.messages.create({
                model: "claude-sonnet-4-20250514",
                max_tokens: 4096,
                system: SYSTEM_PROMPT,
                tools,
                messages,
            });

            // Check if Claude wants to use a tool
            if (response.stop_reason === "tool_use") {
                // Find all tool use blocks
                const toolUseBlocks = response.content.filter(
                    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
                );

                // Add Claude's response to messages
                messages.push({ role: "assistant", content: response.content });

                // Process each tool call and collect results
                const toolResults: Anthropic.ToolResultBlockParam[] = [];

                for (const toolUse of toolUseBlocks) {
                    if (toolUse.name === "search_person") {
                        const input = toolUse.input as { query: string };

                        try {
                            // Call the Tavily search function (teammate implements)
                            const searchResults = await searchPerson(input.query);
                            toolResults.push({
                                type: "tool_result",
                                tool_use_id: toolUse.id,
                                content: searchResults
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
                messages.push({ role: "user", content: toolResults });

            } else {
                // Claude gave a final response (not a tool call)
                continueLoop = false;

                const responseText = response.content
                    .filter((block): block is Anthropic.TextBlock => block.type === "text")
                    .map(block => block.text)
                    .join("\n");

                // Check if Claude is asking for more information
                if (responseText.includes("?") && !responseText.includes("##") && responseText.length < 200) {
                    return NextResponse.json({
                        type: "question",
                        message: responseText,
                        conversationHistory: [
                            ...messages,
                            { role: "assistant", content: response.content }
                        ]
                    });
                }

                // Claude has compiled the research report
                return NextResponse.json({
                    type: "report",
                    report: responseText,
                    personName,
                    company,
                    conversationHistory: messages
                });
            }
        }

        // Fallback (shouldn't reach here)
        return NextResponse.json({ error: "Unexpected end of processing" }, { status: 500 });

    } catch (error) {
        console.error("Error in research agent:", error);
        return NextResponse.json(
            { error: "Failed to process request" },
            { status: 500 }
        );
    }
}
