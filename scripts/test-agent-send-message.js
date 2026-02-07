#!/usr/bin/env node
/**
 * Test script for the agent's send_message tool functionality
 *
 * This script tests the send_message functionality locally without requiring
 * the full Supabase Edge Functions runtime.
 *
 * Run with:
 *   node scripts/test-agent-send-message.js
 *
 * Requires environment variables (set them or create supabase/.env):
 *   - ANTHROPIC_API_KEY
 *   - TAVILY_API_KEY (optional, for search functionality)
 */

const Anthropic = require("@anthropic-ai/sdk").default;
const fs = require("fs");
const path = require("path");

// Load environment variables from supabase/.env
function loadEnv() {
  const envPath = path.join(__dirname, "..", "supabase", ".env");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex);
          const value = trimmed.substring(eqIndex + 1);
          process.env[key] = value;
        }
      }
    }
    console.log("✅ Loaded environment from supabase/.env");
  } else {
    console.log("⚠️  supabase/.env not found, using existing environment variables");
  }
}

// Tool definitions matching agent.ts
const tools = [
  {
    name: "search_person",
    description:
      "Search the web for information about a person, including their professional background, company, recent news, and social profiles.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The person's full name" },
        company: { type: "string", description: "The company they work for" },
        role: { type: "string", description: "Their job title or role" },
        location: { type: "string", description: "Their location (city, state, country)" },
      },
      required: ["name"],
    },
  },
  {
    name: "send_message",
    description:
      "Send an SMS message to the user. Use this to provide updates, ask follow-up questions, or deliver information to the user during the conversation.",
    input_schema: {
      type: "object",
      properties: {
        message: { type: "string", description: "The message text to send to the user" },
      },
      required: ["message"],
    },
  },
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

// Track sent messages
const sentMessages = [];

// Mock sendSMS function
async function mockSendSMS(phoneNumber, message) {
  const timestamp = new Date();
  sentMessages.push({ phoneNumber, message, timestamp });

  console.log("\n" + "=".repeat(60));
  console.log("📤 SMS SENT via send_message tool (mock)");
  console.log("=".repeat(60));
  console.log(`📱 To: ${phoneNumber}`);
  console.log(`⏰ Time: ${timestamp.toISOString()}`);
  console.log("-".repeat(60));
  console.log(message);
  console.log("=".repeat(60) + "\n");
}

// Mock search function (returns dummy data for testing)
async function mockSearchPerson(query) {
  console.log(`\n🔍 [Mock] Searching for: ${JSON.stringify(query)}`);

  // Return mock search results
  return [
    {
      title: `${query.name} - Professional Profile`,
      url: "https://example.com/profile",
      content: `${query.name} is a notable professional${query.company ? ` at ${query.company}` : ""}${query.role ? ` serving as ${query.role}` : ""}. They have extensive experience in their field and are known for their leadership.`,
    },
    {
      title: "Recent News",
      url: "https://example.com/news",
      content: `Recent developments involving ${query.name} include industry speaking engagements and thought leadership contributions.`,
    },
  ];
}

// Format search results for Claude
function formatSearchResults(results) {
  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join("\n\n");
}

// Simplified agent implementation for testing
async function testReceiveMessage(phoneNumber, msg, sendSMS) {
  console.log(`\n📨 Received message from ${phoneNumber}: "${msg}"`);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages = [{ role: "user", content: msg }];

  let continueLoop = true;
  let loopCount = 0;
  const maxLoops = 10;

  while (continueLoop && loopCount < maxLoops) {
    loopCount++;
    console.log(`\n🔄 Agentic loop iteration ${loopCount}`);

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    console.log(`   Stop reason: ${response.stop_reason}`);
    console.log(`   Content blocks: ${response.content.length}`);

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");
      console.log(`   Tools requested: ${toolUseBlocks.map((t) => t.name).join(", ")}`);

      messages.push({ role: "assistant", content: response.content });

      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`\n   ⚙️  Processing tool: ${toolUse.name}`);
        console.log(`      Input: ${JSON.stringify(toolUse.input)}`);

        if (toolUse.name === "search_person") {
          const results = await mockSearchPerson(toolUse.input);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: formatSearchResults(results),
          });
        } else if (toolUse.name === "send_message") {
          try {
            await sendSMS(phoneNumber, toolUse.input.message);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: "Message sent successfully",
            });
            console.log("   ✅ send_message tool executed successfully");
          } catch (error) {
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: `Failed to send message: ${error.message}`,
              is_error: true,
            });
            console.log(`   ❌ send_message tool failed: ${error.message}`);
          }
        }
      }

      messages.push({ role: "user", content: toolResults });
    } else {
      continueLoop = false;

      const responseText = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      if (responseText) {
        console.log("\n📝 Final response from Claude:");
        console.log("-".repeat(40));
        console.log(responseText);
        console.log("-".repeat(40));

        // Send final response to user
        await sendSMS(phoneNumber, responseText);
      }
    }
  }

  if (loopCount >= maxLoops) {
    console.error("⚠️  Hit max loop limit!");
  }
}

async function runTests() {
  console.log("\n🧪 Test 1: Basic message requesting information");
  console.log("=".repeat(60));

  sentMessages.length = 0;

  await testReceiveMessage(
    "+15551234567",
    "I have a meeting with someone named John Smith from Acme Corp. Can you help me prepare?",
    mockSendSMS
  );

  console.log(`\n📊 Test 1 Results: ${sentMessages.length} message(s) sent`);

  console.log("\n\n🧪 Test 2: Message that should prompt questions");
  console.log("=".repeat(60));

  sentMessages.length = 0;

  await testReceiveMessage("+15559876543", "I need info on Sarah", mockSendSMS);

  console.log(`\n📊 Test 2 Results: ${sentMessages.length} message(s) sent`);
}

async function main() {
  console.log("🔍 HeadsUp Agent send_message Tool Test");
  console.log("=".repeat(60));

  loadEnv();

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error("❌ ANTHROPIC_API_KEY is not set");
    console.error("   Set it in your environment or in supabase/.env");
    process.exit(1);
  }
  console.log(`✅ ANTHROPIC_API_KEY: ${anthropicKey.substring(0, 10)}...`);

  try {
    await runTests();

    console.log("\n" + "=".repeat(60));
    console.log("✨ All tests completed!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ Test failed with error:", error);
    process.exit(1);
  }
}

main();
