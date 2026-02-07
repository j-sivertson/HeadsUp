import { parseIntent, generateReport } from "./anthropic";
import { searchPerson, extractFromUrl, PersonQuery } from "./tavily";
import { sendSMS } from "./surge";
import {
  getOrCreateConversation,
  updateConversation,
  addMessage,
  completeConversation,
} from "./conversation";

// ─── Types ───────────────────────────────────────────────────────────────────

interface IncomingMessage {
  body: string;
  senderPhone: string;
  senderFirstName?: string;
  senderLastName?: string;
}

// ─── Main Pipeline ───────────────────────────────────────────────────────────

/**
 * Process an incoming SMS message through the full research pipeline.
 *
 * Flow:
 *  1. Get or create conversation for this sender
 *  2. Use Claude to parse intent and extract person details
 *  3. If not enough info → send follow-up question
 *  4. If enough info → research the person and send the report
 */
export async function processIncomingMessage(
  message: IncomingMessage
): Promise<void> {
  const { body, senderPhone, senderFirstName, senderLastName } = message;

  // 1. Get or create conversation
  const contactName = [senderFirstName, senderLastName]
    .filter(Boolean)
    .join(" ");
  const conversation = getOrCreateConversation(senderPhone, contactName);

  // Record the user's message
  addMessage(senderPhone, "user", body);

  try {
    // 2. Parse intent with Claude
    const intentResult = await parseIntent(body, conversation.messages.slice(0, -1));

    // Update accumulated person query
    updateConversation(senderPhone, {
      personQuery: intentResult.personQuery,
    });

    // 3. Decision: follow up or research
    if (!intentResult.readyToResearch) {
      // Need more info — send follow-up question
      const question =
        intentResult.followUpQuestion ||
        "Could you share more details? I need at least a name and one other detail (company, role, or location) to research this person.";

      addMessage(senderPhone, "assistant", question);

      await sendSMS(senderPhone, question, {
        firstName: senderFirstName,
        lastName: senderLastName,
      });

      return;
    }

    // 4. Ready to research — notify user we're working on it
    const workingMessage = `Got it! Researching ${intentResult.personQuery.name} now. I'll have your briefing in a moment...`;
    addMessage(senderPhone, "assistant", workingMessage);

    await sendSMS(senderPhone, workingMessage, {
      firstName: senderFirstName,
      lastName: senderLastName,
    });

    // Update state to researching
    updateConversation(senderPhone, { state: "researching" });

    // 5. Run the research
    const report = await researchPerson(intentResult.personQuery);

    // 6. Send the report
    addMessage(senderPhone, "assistant", report);

    await sendSMS(senderPhone, report, {
      firstName: senderFirstName,
      lastName: senderLastName,
    });

    // 7. Mark conversation complete
    completeConversation(senderPhone);
  } catch (error) {
    console.error("Error processing message:", error);

    const errorMessage =
      "Sorry, I ran into an issue while researching. Please try again in a moment.";
    addMessage(senderPhone, "assistant", errorMessage);

    await sendSMS(senderPhone, errorMessage, {
      firstName: senderFirstName,
      lastName: senderLastName,
    });
  }
}

// ─── Research Subroutine ─────────────────────────────────────────────────────

/**
 * Research a person: search the web, optionally extract LinkedIn, then
 * generate a briefing report with Claude.
 */
async function researchPerson(person: PersonQuery): Promise<string> {
  // Run web search and optional LinkedIn extraction in parallel
  const searchPromise = searchPerson(person);
  const linkedinPromise = person.linkedinUrl
    ? extractFromUrl(person.linkedinUrl)
    : Promise.resolve("");

  const [searchResults, linkedinContent] = await Promise.all([
    searchPromise,
    linkedinPromise,
  ]);

  // If we got LinkedIn content, add it to the search results
  if (linkedinContent) {
    searchResults.push({
      title: "LinkedIn Profile",
      url: person.linkedinUrl || "",
      content: linkedinContent,
    });
  }

  // Generate the report with Claude
  const report = await generateReport(person, searchResults);

  return report;
}
