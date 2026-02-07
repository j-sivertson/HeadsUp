# Surge API Documentation

This document provides a comprehensive guide to integrating with the Surge SMS API for sending and receiving SMS messages.

## Table of Contents

- [Authentication](#authentication)
- [API Base URL](#api-base-url)
- [Sending SMS Messages](#sending-sms-messages)
- [Receiving SMS Messages (Webhooks)](#receiving-sms-messages-webhooks)
- [Webhook Signature Validation](#webhook-signature-validation)
- [TypeScript Code Examples](#typescript-code-examples)
- [Best Practices](#best-practices)

---

## Authentication

Surge uses **Bearer token authentication** for all API requests.

### Header Format

```
Authorization: Bearer <your_surge_api_token>
```

### Token Types

Surge provides two token types for different use cases:

| Token Type | Lifespan | Scope | Use Case |
|------------|----------|-------|----------|
| **Publishable Account Tokens** | Infinite | Account-wide | Embedded UI components |
| **Signed User Tokens** | Up to 1 hour | Individual user | Secure embedded components |

For server-side API calls (sending SMS), use your API token from the Surge dashboard.

---

## API Base URL

```
https://api.surge.app
```

---

## Sending SMS Messages

### Endpoint

```
POST /accounts/{account_id}/messages
```

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `account_id` | string | Yes | The account from which the message should be sent. Example: `acct_01j9a43avnfqzbjfch6pygv1td` |

### Request Headers

```
Authorization: Bearer <token>
Content-Type: application/json
```

### Request Body

You can send messages using two formats:

#### Option 1: Simple Format

```json
{
  "to": "+15551234567",
  "from": "+15559876543",
  "body": "Hello from Surge!",
  "metadata": {
    "order_id": "12345"
  }
}
```

#### Option 2: With Conversation Object

```json
{
  "conversation": {
    "contact": {
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "+15551234567"
    },
    "phone_number": "+15559876543"
  },
  "body": "Hello from Surge!",
  "attachments": [
    { "url": "https://example.com/image.png" }
  ],
  "metadata": {
    "custom_field": "value"
  }
}
```

### Request Body Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to` | string | Yes* | Recipient phone number in E.164 format (e.g., `+15551234567`) |
| `from` | string | No | Sender phone number or phone ID. Defaults to account's phone number |
| `body` | string | Conditional | Message text. Required if no attachments |
| `attachments` | array | Conditional | Array of objects with `url` field. Required if no body |
| `metadata` | object | No | Custom key-value pairs (max 50 properties, 500 chars each) |
| `send_at` | string | No | ISO8601 datetime for scheduling (up to 60 days ahead) |

*Use either `to` or `conversation` object, not both.

### Scheduling Messages

Schedule messages up to 60 days in advance using ISO8601 format:

```json
{
  "to": "+15551234567",
  "body": "Reminder: Your appointment is tomorrow!",
  "send_at": "2024-12-15T09:00:00Z"
}
```

### Response

#### Success (201 Created)

```json
{
  "id": "msg_01jjfeev3hf9n9c7k5231hd3hr",
  "body": "Hello from Surge!",
  "conversation": {
    "id": "conv_01abc123",
    "contact": {
      "id": "cont_01xyz789",
      "first_name": "John",
      "last_name": "Doe",
      "phone_number": "+15551234567"
    },
    "phone_number": "+15559876543"
  },
  "attachments": [],
  "metadata": {},
  "blast_id": null
}
```

#### Error Response

```json
{
  "error": {
    "type": "not_found",
    "message": "Account not found",
    "detail": "The specified account_id does not exist"
  }
}
```

### Important Notes

- Messages are always sent **asynchronously** - the API returns immediately with a message ID
- Actual delivery occurs later and triggers webhook events (`message.sent`, `message.delivered`, `message.failed`)
- Surge downloads and sends attachment files on your behalf

---

## Receiving SMS Messages (Webhooks)

Surge notifies your application of SMS events via webhooks, eliminating the need for polling.

### Setup Requirements

1. Create a publicly accessible HTTPS endpoint
2. Register the webhook URL in the Surge dashboard
3. Implement handlers for relevant event types

### Webhook Events

#### Message Events

| Event | Description |
|-------|-------------|
| `message.received` | Triggered when an SMS arrives at your Surge number |
| `message.sent` | Triggered after message leaves Surge system |
| `message.delivered` | Triggered when carrier confirms delivery |
| `message.failed` | Triggered when message delivery fails |

#### Contact Events

| Event | Description |
|-------|-------------|
| `contact.opted_in` | Contact sent START, YES, or UNSTOP |
| `contact.opted_out` | Contact sent STOP, CANCEL, or UNSUBSCRIBE |

#### Other Events

| Event | Description |
|-------|-------------|
| `conversation.created` | New conversation initiated |
| `campaign.approved` | Campaign approved by carriers |
| `call.ended` | Call completed on Surge number |
| `link.followed` | Shortened link clicked (first click only) |

### Webhook Payload Format

```json
{
  "type": "message.received",
  "id": "evt_01jjfeev3hf9n9c7k5231hd3hr",
  "data": {
    "id": "msg_01abc123",
    "body": "Hello, I need help!",
    "conversation": {
      "id": "conv_01xyz789",
      "contact": {
        "id": "cont_01def456",
        "first_name": "Jane",
        "last_name": "Smith",
        "phone_number": "+15551234567"
      },
      "phone_number": "+15559876543"
    },
    "attachments": [],
    "metadata": {}
  }
}
```

### Response Requirements

Your endpoint must respond with:
- **HTTP 200 OK** or **HTTP 201 Created**

If delivery fails, Surge will retry up to **20 times** using exponential backoff with jitter.

---

## Webhook Signature Validation

Each webhook includes a `Surge-Signature` header for verifying authenticity.

### Signature Header Format

```
Surge-Signature: t=1737830031,v1=41f947e88a483327c878d6c08b27b22fbe7c9ea5608b035707c6667d1df866dd
```

| Component | Description |
|-----------|-------------|
| `t` | Unix timestamp when webhook was sent |
| `v1` | HMAC-SHA256 signature (lowercase hex-encoded) |

### Validation Process

1. **Parse the header** - Extract `t` (timestamp) and `v1` (signature)
2. **Check timestamp** - Ensure it's within acceptable window (e.g., 5 minutes) to prevent replay attacks
3. **Construct signed payload** - Concatenate: `{timestamp}.{raw_request_body}`
4. **Compute HMAC-SHA256** - Using your signing secret
5. **Compare signatures** - Use constant-time comparison

### Signed Payload Example

```
1737830031.{"type":"message.received","id":"evt_01jjfeev3hf9n9c7k5231hd3hr",...}
```

---

## TypeScript Code Examples

### Surge API Client

```typescript
// lib/surge.ts

interface SurgeConfig {
  apiToken: string;
  accountId: string;
  defaultFromNumber?: string;
}

interface SendMessageParams {
  to: string;
  body: string;
  from?: string;
  attachments?: Array<{ url: string }>;
  metadata?: Record<string, string>;
  sendAt?: string;
}

interface MessageResponse {
  id: string;
  body: string | null;
  conversation: {
    id: string;
    contact: {
      id: string;
      first_name: string;
      last_name: string;
      phone_number: string;
    };
    phone_number: string;
  };
  attachments: Array<{ id: string; type: string; url: string }>;
  metadata: Record<string, string>;
  blast_id: string | null;
}

export class SurgeClient {
  private baseUrl = "https://api.surge.app";
  private config: SurgeConfig;

  constructor(config: SurgeConfig) {
    this.config = config;
  }

  async sendMessage(params: SendMessageParams): Promise<MessageResponse> {
    const response = await fetch(
      `${this.baseUrl}/accounts/${this.config.accountId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: params.to,
          from: params.from || this.config.defaultFromNumber,
          body: params.body,
          attachments: params.attachments,
          metadata: params.metadata,
          send_at: params.sendAt,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Surge API Error: ${error.error?.message || response.statusText}`);
    }

    return response.json();
  }
}
```

### Webhook Handler with Signature Validation

```typescript
// lib/webhook.ts

import { createHmac, timingSafeEqual } from "crypto";

interface WebhookEvent {
  type: string;
  id: string;
  data: {
    id: string;
    body: string;
    conversation: {
      id: string;
      contact: {
        id: string;
        first_name: string;
        last_name: string;
        phone_number: string;
      };
      phone_number: string;
    };
    attachments: Array<{ id: string; type: string; url: string }>;
    metadata: Record<string, string>;
  };
}

interface SignatureValidationResult {
  valid: boolean;
  error?: string;
}

export function validateWebhookSignature(
  signatureHeader: string,
  rawBody: string,
  signingSecret: string,
  toleranceSeconds: number = 300 // 5 minutes
): SignatureValidationResult {
  // Parse the signature header
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) {
    return { valid: false, error: "Invalid signature header format" };
  }

  // Check timestamp is within tolerance
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > toleranceSeconds) {
    return { valid: false, error: "Webhook timestamp outside tolerance window" };
  }

  // Construct the signed payload
  const signedPayload = `${timestamp}.${rawBody}`;

  // Compute expected signature
  const expectedSignature = createHmac("sha256", signingSecret)
    .update(signedPayload)
    .digest("hex");

  // Compare using constant-time comparison
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  for (const signature of signatures) {
    try {
      const receivedBuffer = Buffer.from(signature, "hex");
      if (
        expectedBuffer.length === receivedBuffer.length &&
        timingSafeEqual(expectedBuffer, receivedBuffer)
      ) {
        return { valid: true };
      }
    } catch {
      // Invalid hex, try next signature
    }
  }

  return { valid: false, error: "Signature verification failed" };
}

export function parseWebhookPayload(rawBody: string): WebhookEvent {
  return JSON.parse(rawBody) as WebhookEvent;
}
```

### Complete Webhook Handler (Supabase Edge Function)

```typescript
// supabase/functions/sms-webhook/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SURGE_API_TOKEN = Deno.env.get("SURGE_API_TOKEN")!;
const SURGE_ACCOUNT_ID = Deno.env.get("SURGE_ACCOUNT_ID")!;
const SURGE_SIGNING_SECRET = Deno.env.get("SURGE_SIGNING_SECRET")!;
const SURGE_PHONE_NUMBER = Deno.env.get("SURGE_PHONE_NUMBER")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Validate webhook signature
function validateSignature(
  signatureHeader: string,
  rawBody: string,
  toleranceSeconds = 300
): boolean {
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) return false;

  // Check timestamp
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > toleranceSeconds) return false;

  // Compute expected signature using Web Crypto API (Deno)
  const encoder = new TextEncoder();
  const keyData = encoder.encode(SURGE_SIGNING_SECRET);
  const signedPayload = encoder.encode(`${timestamp}.${rawBody}`);

  // Note: In Deno, use SubtleCrypto for HMAC
  // This is a simplified version - implement full crypto in production
  return true; // Placeholder - implement proper validation
}

// Send SMS via Surge API
async function sendSMS(to: string, message: string): Promise<void> {
  const response = await fetch(
    `https://api.surge.app/accounts/${SURGE_ACCOUNT_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SURGE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: to,
        from: SURGE_PHONE_NUMBER,
        body: message,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to send SMS: ${error.error?.message || response.statusText}`);
  }
}

serve(async (req) => {
  try {
    // Get raw body for signature validation
    const rawBody = await req.text();
    const signatureHeader = req.headers.get("Surge-Signature");

    // Validate webhook signature
    if (!signatureHeader || !validateSignature(signatureHeader, rawBody)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse webhook payload
    const payload = JSON.parse(rawBody);

    // Only process message.received events
    if (payload.type !== "message.received") {
      return new Response(JSON.stringify({ success: true, skipped: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract message details
    const messageBody = payload.data.body;
    const senderPhone = payload.data.conversation.contact.phone_number;
    const conversationId = payload.data.conversation.id;

    // Initialize Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Store incoming message
    await supabase.from("messages").insert({
      surge_conversation_id: conversationId,
      phone_number: senderPhone,
      role: "user",
      content: messageBody,
    });

    // Process with your agent logic
    const agentResponse = await processWithAgent(messageBody);

    // Store agent response
    await supabase.from("messages").insert({
      surge_conversation_id: conversationId,
      phone_number: senderPhone,
      role: "assistant",
      content: agentResponse,
    });

    // Send response via SMS
    await sendSMS(senderPhone, agentResponse);

    return new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function processWithAgent(message: string): Promise<string> {
  // TODO: Implement your agent logic here
  return `You said: "${message}". How can I help you?`;
}
```

### Deno-Compatible HMAC Signature Validation

```typescript
// lib/crypto.ts (Deno version)

export async function validateWebhookSignatureDeno(
  signatureHeader: string,
  rawBody: string,
  signingSecret: string,
  toleranceSeconds: number = 300
): Promise<boolean> {
  // Parse header
  const parts = signatureHeader.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) return false;

  // Check timestamp
  const timestampNum = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampNum) > toleranceSeconds) return false;

  // Compute HMAC-SHA256 using Web Crypto API
  const encoder = new TextEncoder();
  const keyData = encoder.encode(signingSecret);
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

  // Compare signatures
  return signatures.some((sig) => sig === expectedSignature);
}
```

---

## Best Practices

### Webhook Handling

1. **Idempotency** - Design handlers to safely process duplicate webhooks
2. **Signature Validation** - Always validate `Surge-Signature` header
3. **Quick Response** - Respond promptly (< 30s) to avoid retry attempts
4. **Error Handling** - Log errors but return 200 to prevent unnecessary retries for permanent failures

### Message Sending

1. **Rate Limiting** - Implement rate limiting per phone number
2. **E.164 Format** - Always use E.164 format for phone numbers (e.g., `+15551234567`)
3. **Error Handling** - Handle async delivery failures via webhooks
4. **Metadata** - Use metadata for tracking and correlation

### Security

1. **Token Security** - Store API tokens securely using environment variables
2. **Timestamp Validation** - Reject webhooks with timestamps outside tolerance window
3. **HTTPS Only** - Webhook endpoints must use HTTPS
4. **Input Sanitization** - Sanitize all incoming message content

---

## Support

For questions or implementation assistance, contact: **support@surge.app**
