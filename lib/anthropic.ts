import Anthropic from "@anthropic-ai/sdk";
import { PersonQuery, SearchResult } from "./tavily";

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = "claude-sonnet-4-20250514";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParseIntentResult {
  /** Whether we have enough info to begin researching */
  readyToResearch: boolean;
  /** Extracted/accumulated person details so far */
  personQuery: PersonQuery;
  /** Follow-up question to ask the user (if not ready) */
  followUpQuestion?: string;
}

export interface MessageEntry {
  role: "user" | "assistant";
  content: string;
}

// ─── Parse Intent ────────────────────────────────────────────────────────────

const PARSE_INTENT_SYSTEM = `You are HeadsUp, an SMS assistant that helps people quickly research someone before a meeting.

Your job is to extract information about the person the user wants to research from their messages. You need to gather enough details to perform a useful web search.

MINIMUM required: The person's full name AND at least one qualifying detail (company, role/title, location, LinkedIn URL, or other identifying context).

From the conversation, extract these fields:
- name (required)
- company (if mentioned)
- role (if mentioned)
- location (if mentioned)
- linkedinUrl (if mentioned)
- additionalContext (any other useful details)

Respond with ONLY valid JSON in this exact format:
{
  "readyToResearch": true/false,
  "personQuery": {
    "name": "...",
    "company": "...",
    "role": "...",
    "location": "...",
    "linkedinUrl": "...",
    "additionalContext": "..."
  },
  "followUpQuestion": "..." 
}

Rules:
- If you have a name + at least one qualifier, set readyToResearch to true
- If you only have a name with no other details, ask for more info
- If the message is unclear or not about researching a person, ask for clarification
- Keep followUpQuestion concise and friendly (this goes via SMS)
- Only include fields in personQuery that have actual values (omit empty ones)`;

/**
 * Parse the user's SMS message(s) to determine intent and extract person info.
 */
export async function parseIntent(
  currentMessage: string,
  history: MessageEntry[]
): Promise<ParseIntentResult> {
  const messages: Anthropic.MessageParam[] = [
    // Include conversation history
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    // Current message
    { role: "user" as const, content: currentMessage },
  ];

  const response = await anthropicClient.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: PARSE_INTENT_SYSTEM,
    messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    // Extract JSON from the response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        readyToResearch: false,
        personQuery: { name: "" },
        followUpQuestion:
          "I didn't quite catch that. Who would you like me to research before your meeting? Please share their name and any details you know (company, role, etc.).",
      };
    }
    return JSON.parse(jsonMatch[0]) as ParseIntentResult;
  } catch {
    return {
      readyToResearch: false,
      personQuery: { name: "" },
      followUpQuestion:
        "Sorry, I had trouble understanding. Could you tell me the name of the person you want to research, along with their company or role?",
    };
  }
}

// ─── Generate Report ─────────────────────────────────────────────────────────

const GENERATE_REPORT_SYSTEM = `You are HeadsUp, an SMS-based research assistant. You've just gathered web search results about a person that someone is about to meet.

Your job is to write a concise, useful briefing that will be sent via SMS. The report should help someone walk into a meeting feeling prepared.

Format guidelines:
- Keep it under 1400 characters (SMS-friendly)
- Start with a one-line summary of who the person is
- Use short bullet points for key facts
- Include: current role, career highlights, notable achievements, recent news, and any relevant talking points
- End with 1-2 suggested conversation starters based on the person's interests or recent work
- Be factual — only include information supported by the search results
- If search results are thin, be honest about it and share what you found
- Do NOT use markdown formatting (no **, no ##, no links) — this is plain SMS text`;

/**
 * Generate a concise person briefing report from search results.
 */
export async function generateReport(
  person: PersonQuery,
  searchResults: SearchResult[]
): Promise<string> {
  const searchContext = searchResults
    .map(
      (r, i) =>
        `[Source ${i + 1}] ${r.title}\n${r.url ? `URL: ${r.url}` : ""}\n${r.content}`
    )
    .join("\n\n---\n\n");

  const personSummary = [
    `Name: ${person.name}`,
    person.company && `Company: ${person.company}`,
    person.role && `Role: ${person.role}`,
    person.location && `Location: ${person.location}`,
    person.additionalContext && `Context: ${person.additionalContext}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await anthropicClient.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: GENERATE_REPORT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Please create a briefing report for this person I'm about to meet:\n\n${personSummary}\n\nHere are the web search results:\n\n${searchContext}`,
      },
    ],
  });

  return response.content[0].type === "text"
    ? response.content[0].text
    : "Sorry, I was unable to generate a report at this time.";
}

export { anthropicClient };
