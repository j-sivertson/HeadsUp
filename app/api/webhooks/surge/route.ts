import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { processIncomingMessage } from "@/lib/research";

// ─── Types for Surge Webhook Payload ─────────────────────────────────────────

interface SurgeWebhookPayload {
  account_id: string;
  data: {
    body: string;
    attachments?: Array<{
      id: string;
      type: string;
      url: string;
    }>;
    conversation: {
      contact: {
        id: string;
        first_name?: string;
        last_name?: string;
        phone_number: string;
      };
      id: string;
      phone_number: {
        id: string;
        number: string;
        type: string;
      };
    };
    id: string;
    received_at: string;
  };
  timestamp: string;
  type: string;
}

// ─── Webhook Signature Validation ────────────────────────────────────────────

function validateSignature(
  rawBody: string,
  signatureHeader: string
): boolean {
  const secret = process.env.SURGE_WEBHOOK_SECRET;

  // Skip validation if no secret is configured (dev mode)
  if (!secret) {
    console.warn(
      "SURGE_WEBHOOK_SECRET not set — skipping signature validation"
    );
    return true;
  }

  try {
    // Parse the Surge-Signature header: t=<timestamp>,v1=<hash>
    const params = new Map<string, string[]>();
    for (const part of signatureHeader.split(",")) {
      const [key, value] = part.split("=", 2);
      if (!params.has(key)) params.set(key, []);
      params.get(key)!.push(value);
    }

    const timestamp = params.get("t")?.[0];
    const signatures = params.get("v1") || [];

    if (!timestamp || signatures.length === 0) {
      console.error("Invalid Surge-Signature header format");
      return false;
    }

    // Build the signed payload: rawBody.timestamp
    const payload = `${timestamp}.${rawBody}`;

    // Compute expected HMAC-SHA256
    const expectedHash = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    // Check if any of the v1 signatures match
    return signatures.some(
      (sig) =>
        crypto.timingSafeEqual(
          Buffer.from(sig, "hex"),
          Buffer.from(expectedHash, "hex")
        )
    );
  } catch (error) {
    console.error("Signature validation error:", error);
    return false;
  }
}

// ─── POST Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Read the raw body for signature validation
    const rawBody = await request.text();
    const signatureHeader = request.headers.get("Surge-Signature") || "";

    // Validate the webhook signature
    if (!validateSignature(rawBody, signatureHeader)) {
      console.error("Invalid webhook signature");
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Parse the payload
    const payload: SurgeWebhookPayload = JSON.parse(rawBody);

    // Only handle message.received events
    if (payload.type !== "message.received") {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const { data } = payload;

    console.log(
      `[HeadsUp] Incoming SMS from ${data.conversation.contact.phone_number}: "${data.body}"`
    );

    // Process the message asynchronously (don't block the webhook response)
    // Surge expects a quick 200 response
    processIncomingMessage({
      body: data.body,
      senderPhone: data.conversation.contact.phone_number,
      senderFirstName: data.conversation.contact.first_name,
      senderLastName: data.conversation.contact.last_name,
    }).catch((error) => {
      console.error("[HeadsUp] Error processing message:", error);
    });

    // Return 200 immediately to acknowledge the webhook
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[HeadsUp] Webhook error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── GET Handler (Health Check) ──────────────────────────────────────────────

export async function GET() {
  return NextResponse.json({
    service: "HeadsUp SMS Webhook",
    status: "active",
    timestamp: new Date().toISOString(),
  });
}
