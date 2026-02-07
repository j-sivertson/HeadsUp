// SMS Agent Edge Function
// Receives webhooks from Surge API and processes incoming SMS messages
// Deploy with: supabase functions deploy sms-agent

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { receiveMessage } from "../_shared/agent.ts";

// Environment variables
const SURGE_API_TOKEN = Deno.env.get("SURGE_API_TOKEN") || Deno.env.get("SURGE_API_KEY")!;
const SURGE_ACCOUNT_ID = Deno.env.get("SURGE_ACCOUNT_ID")!;
const SURGE_SIGNING_SECRET = Deno.env.get("SURGE_SIGNING_SECRET");

// Log environment variable status at startup
console.log("=== ENVIRONMENT CHECK ===");
console.log(`SURGE_API_TOKEN: ${SURGE_API_TOKEN ? "SET" : "MISSING"}`);
console.log(`SURGE_ACCOUNT_ID: ${SURGE_ACCOUNT_ID ? "SET" : "MISSING"}`);
console.log(`SURGE_SIGNING_SECRET: ${SURGE_SIGNING_SECRET ? "SET" : "MISSING"}`);
console.log(`ANTHROPIC_API_KEY: ${Deno.env.get("ANTHROPIC_API_KEY") ? "SET" : "MISSING"}`);
console.log(`TAVILY_API_KEY: ${Deno.env.get("TAVILY_API_KEY") ? "SET" : "MISSING"}`);
console.log("=========================");

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
  console.log(`[sendSMS] To: ${to}`);
  console.log(`[sendSMS] Message length: ${message.length}`);
  console.log(`[sendSMS] Message: ${message}`);
  console.log(`[sendSMS] SURGE_ACCOUNT_ID: ${SURGE_ACCOUNT_ID ? "SET" : "MISSING"}`);
  console.log(`[sendSMS] SURGE_API_TOKEN: ${SURGE_API_TOKEN ? "SET" : "MISSING"}`);

  const url = `https://api.surge.app/accounts/${SURGE_ACCOUNT_ID}/messages`;
  console.log(`[sendSMS] URL: ${url}`);

  const requestBody = {
    body: message,
    conversation: {
      contact: {
        phone_number: to,
      },
    },
  };
  console.log(`[sendSMS] Request body:`, JSON.stringify(requestBody));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SURGE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log(`[sendSMS] Response status: ${response.status} ${response.statusText}`);

    const responseText = await response.text();
    console.log(`[sendSMS] Response body: ${responseText}`);

    if (!response.ok) {
      let errorMessage = response.statusText;
      try {
        const errorJson = JSON.parse(responseText);
        errorMessage = errorJson.error?.message || errorMessage;
      } catch {
        // Response wasn't JSON
      }
      throw new Error(`Failed to send SMS: ${errorMessage}`);
    }

    const result = JSON.parse(responseText);
    console.log("[sendSMS] SMS sent successfully, id:", result.id);
    console.log("====================");
  } catch (error) {
    console.error("[sendSMS] Error:", error);
    throw error;
  }
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
    await receiveMessage(senderPhone, messageBody, sendSMS);

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
