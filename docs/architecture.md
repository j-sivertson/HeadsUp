# SMS Agent Architecture

## System Overview

```
┌─────────────┐         ┌─────────────────┐         ┌──────────────────────────┐
│             │  SMS    │                 │ Webhook │                          │
│    User     │────────▶│   Surge API     │────────▶│  Supabase Edge Function  │
│   (Phone)   │         │  (SMS Gateway)  │   POST  │    (Agent Processor)     │
│             │◀────────│                 │◀────────│                          │
└─────────────┘   SMS   └─────────────────┘   API   └──────────────────────────┘
                                                              │
                                                              │ Tool Calls
                                                              ▼
                                                    ┌──────────────────┐
                                                    │                  │
                                                    │  Supabase DB     │
                                                    │  (State/History) │
                                                    │                  │
                                                    └──────────────────┘
```

## Data Flow

```
1. INBOUND MESSAGE
   ┌──────┐    SMS     ┌───────┐   HTTP POST    ┌────────────────┐
   │ User │ ─────────▶ │ Surge │ ─────────────▶ │ Edge Function  │
   └──────┘            └───────┘                └────────────────┘
                                                        │
                                                        ▼
                                                ┌───────────────┐
                                                │ Agent Logic   │
                                                │ - Parse msg   │
                                                │ - Process     │
                                                │ - Decide      │
                                                └───────────────┘
                                                        │
2. OUTBOUND MESSAGE                                     ▼
   ┌──────┐    SMS     ┌───────┐   HTTP POST    ┌───────────────┐
   │ User │ ◀───────── │ Surge │ ◀───────────── │ Send Message  │
   └──────┘            └───────┘                │ (Tool Call)   │
                                                └───────────────┘
```

## Component Details

### 1. Surge API (SMS Gateway)
- **Base URL**: `https://api.surge.app`
- **Authentication**: Bearer token (`Authorization: Bearer <token>`)
- Receives SMS messages from users
- Triggers webhook events (`message.received`, `message.sent`, `message.delivered`, `message.failed`)
- Sends outbound SMS via `POST /accounts/{account_id}/messages`
- Provides phone number provisioning via `POST /accounts/{account_id}/phone_numbers`
- See [Surge API Documentation](./surge-api.md) for complete details

### 2. Supabase Edge Function (Agent Processor)
- Receives webhook payloads from Surge
- Implements agent/LLM logic
- Manages conversation state
- Makes tool calls (including sending SMS responses)

### 3. Supabase Database
- Stores conversation history
- Maintains user state/context
- Logs all interactions

## Implementation Steps

### Step 1: Set Up Supabase Project
```bash
# Initialize Supabase locally
supabase init

# Create edge function
supabase functions new sms-agent
```

### Step 2: Create Database Schema
```sql
-- conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  role TEXT NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for phone lookups
CREATE INDEX idx_conversations_phone ON conversations(phone_number);
```

### Step 3: Implement Edge Function

```typescript
// supabase/functions/sms-agent/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SURGE_API_KEY = Deno.env.get("SURGE_API_KEY")!;
const SURGE_ACCOUNT_ID = Deno.env.get("SURGE_ACCOUNT_ID")!;
const SURGE_PHONE_NUMBER = Deno.env.get("SURGE_PHONE_NUMBER")!;
const SURGE_SIGNING_SECRET = Deno.env.get("SURGE_SIGNING_SECRET")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Tool: Send SMS via Surge API
// API Docs: https://api.surge.app
// Endpoint: POST /accounts/{account_id}/messages
async function sendSMS(to: string, message: string): Promise<void> {
  const SURGE_ACCOUNT_ID = Deno.env.get("SURGE_ACCOUNT_ID")!;

  const response = await fetch(
    `https://api.surge.app/accounts/${SURGE_ACCOUNT_ID}/messages`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SURGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: to,                    // Recipient in E.164 format
        from: SURGE_PHONE_NUMBER,  // Sender phone number or phone ID
        body: message,             // Message text
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to send SMS: ${error.error?.message || response.statusText}`);
  }
}

// Agent processing logic
async function processMessage(
  supabase: any,
  phoneNumber: string,
  messageContent: string
): Promise<string> {
  // 1. Get or create conversation
  let { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("phone_number", phoneNumber)
    .single();

  if (!conversation) {
    const { data: newConv } = await supabase
      .from("conversations")
      .insert({ phone_number: phoneNumber })
      .select()
      .single();
    conversation = newConv;
  }

  // 2. Store incoming message
  await supabase.from("messages").insert({
    conversation_id: conversation.id,
    role: "user",
    content: messageContent,
  });

  // 3. Get conversation history
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });

  // 4. Process with your agent logic (placeholder)
  // Replace this with your actual LLM/agent implementation
  const agentResponse = await runAgentLogic(history, messageContent);

  // 5. Store agent response
  await supabase.from("messages").insert({
    conversation_id: conversation.id,
    role: "assistant",
    content: agentResponse,
  });

  return agentResponse;
}

// Placeholder for agent logic
async function runAgentLogic(
  history: Array<{ role: string; content: string }>,
  currentMessage: string
): Promise<string> {
  // TODO: Implement your LLM/agent logic here
  // This could call OpenAI, Anthropic, or any other AI provider
  return `You said: "${currentMessage}". I'm your AI assistant!`;
}

// Validate Surge webhook signature
// Header format: Surge-Signature: t=1737830031,v1=<hmac_sha256_hex>
async function validateWebhookSignature(
  signatureHeader: string,
  rawBody: string,
  toleranceSeconds = 300
): Promise<boolean> {
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) return false;

  // Check timestamp is within tolerance (prevent replay attacks)
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > toleranceSeconds) return false;

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

serve(async (req) => {
  try {
    // Get raw body for signature validation
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("Surge-Signature");

    // Validate webhook signature
    if (!signatureHeader || !(await validateWebhookSignature(signatureHeader, rawBody))) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse incoming webhook from Surge
    // Webhook payload structure:
    // {
    //   "type": "message.received",
    //   "id": "evt_...",
    //   "data": {
    //     "id": "msg_...",
    //     "body": "Message text",
    //     "conversation": {
    //       "id": "conv_...",
    //       "contact": {
    //         "id": "cont_...",
    //         "phone_number": "+15551234567"
    //       },
    //       "phone_number": "+15559876543"
    //     }
    //   }
    // }
    const payload = JSON.parse(rawBody);

    // Only process message.received events
    if (payload.type !== "message.received") {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract message data from webhook payload
    const messageBody = payload.data.body;
    const senderPhone = payload.data.conversation.contact.phone_number;

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Process the message with agent logic
    const response = await processMessage(supabase, senderPhone, messageBody);

    // Send response back via SMS (tool call)
    await sendSMS(senderPhone, response);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

### Step 4: Configure Surge Webhook

1. Log into Surge dashboard
2. Navigate to Phone Numbers → Your Number → Webhooks
3. Set webhook URL to: `https://<project-ref>.supabase.co/functions/v1/sms-agent`
4. Subscribe to the following webhook events:
   - `message.received` - For incoming SMS messages
   - `message.delivered` - For delivery confirmations (optional)
   - `message.failed` - For delivery failures (optional)
   - `contact.opted_out` - For unsubscribe handling (optional)
5. Copy your webhook signing secret for signature validation

### Step 5: Deploy

```bash
# Set secrets
supabase secrets set SURGE_API_KEY=your_surge_api_key
supabase secrets set SURGE_ACCOUNT_ID=acct_your_account_id
supabase secrets set SURGE_PHONE_NUMBER=+15551234567
supabase secrets set SURGE_SIGNING_SECRET=your_webhook_signing_secret

# Deploy function
supabase functions deploy sms-agent
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SURGE_API_KEY` | API Bearer token from Surge dashboard |
| `SURGE_ACCOUNT_ID` | Your Surge account ID (e.g., `acct_01j9a43avnfqzbjfch6pygv1td`) |
| `SURGE_PHONE_NUMBER` | Your Surge phone number in E.164 format (e.g., `+15551234567`) |
| `SURGE_SIGNING_SECRET` | Webhook signing secret for signature validation |
| `SUPABASE_URL` | Auto-provided by Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-provided by Supabase |

## Security Considerations

1. **Webhook Signature Validation**: Verify the `Surge-Signature` header using HMAC-SHA256 with your signing secret
2. **Timestamp Validation**: Reject webhooks with timestamps outside a tolerance window (e.g., 5 minutes) to prevent replay attacks
3. **Rate Limiting**: Implement rate limiting per phone number
4. **Input Sanitization**: Sanitize all incoming message content
5. **Error Handling**: Never expose internal errors to users
6. **HTTPS Only**: Webhook endpoints must use HTTPS

## File Structure

```
project/
├── supabase/
│   ├── functions/
│   │   └── sms-agent/
│   │       └── index.ts
│   ├── migrations/
│   │   └── 001_create_tables.sql
│   └── config.toml
├── lib/
│   ├── surge.ts          # Surge API client
│   └── agent.ts          # Agent logic
└── package.json
```
