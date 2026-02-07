import Surge from "@surgeapi/node";

// Lazy singleton — only initialized at runtime when env vars are available
let _client: Surge | null = null;

function getClient(): Surge {
  if (!_client) {
    _client = new Surge({ apiKey: process.env.SURGE_API_KEY! });
  }
  return _client;
}

/**
 * Send an SMS reply to a contact via Surge.
 *
 * @param phoneNumber - The recipient's phone number (E.164 format, e.g. "+18015551234")
 * @param body        - The SMS message body
 * @param contactInfo - Optional first/last name of the contact
 */
export async function sendSMS(
  phoneNumber: string,
  body: string,
  contactInfo?: { firstName?: string; lastName?: string }
) {
  const accountId = process.env.SURGE_ACCOUNT_ID!;

  // SMS has a ~1600 character limit per message. If the report is longer,
  // split it into multiple messages.
  const MAX_SMS_LENGTH = 1500;
  const chunks = splitMessage(body, MAX_SMS_LENGTH);

  for (const chunk of chunks) {
    await getClient().messages.create(accountId, {
      body: chunk,
      conversation: {
        contact: {
          phone_number: phoneNumber,
          ...(contactInfo?.firstName && { first_name: contactInfo.firstName }),
          ...(contactInfo?.lastName && { last_name: contactInfo.lastName }),
        },
      },
    });
  }
}

/**
 * Split a long message into chunks that fit within SMS limits.
 * Tries to split on sentence boundaries when possible.
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split at the last sentence boundary within the limit
    let splitIndex = remaining.lastIndexOf(". ", maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      // Fall back to splitting at the last space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex === -1) {
      // Worst case: hard split
      splitIndex = maxLength;
    } else {
      splitIndex += 1; // Include the space or period
    }

    chunks.push(remaining.slice(0, splitIndex).trim());
    remaining = remaining.slice(splitIndex).trim();
  }

  return chunks;
}
