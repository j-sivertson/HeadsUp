# Quick Start Guide

## Prerequisites

1. [Supabase CLI](https://supabase.com/docs/guides/cli) installed
2. [Surge account](https://app.surge.app) with a phone number
3. Deno installed (for local testing)

## Step 1: Configure Environment

```bash
# Copy environment template
cp supabase/.env.example supabase/.env

# Edit with your credentials
# Get Surge credentials from: https://app.surge.app
```

Required variables:
- `SURGE_API_TOKEN` - Your Surge API token
- `SURGE_ACCOUNT_ID` - Your account ID (e.g., `acct_01j9a43...`)
- `SURGE_PHONE_NUMBER` - Your Surge phone number in E.164 format
- `SURGE_SIGNING_SECRET` - Webhook signing secret (optional but recommended)

## Step 2: Test Locally

```bash
# Start Supabase locally
supabase start

# Serve edge functions locally
supabase functions serve sms-agent --env-file supabase/.env
```

Test with curl:
```bash
curl -X POST http://localhost:54321/functions/v1/sms-agent \
  -H "Content-Type: application/json" \
  -d '{
    "type": "message.received",
    "id": "evt_test123",
    "data": {
      "id": "msg_test123",
      "body": "Hello from test!",
      "conversation": {
        "id": "conv_test123",
        "contact": {
          "id": "cont_test123",
          "phone_number": "+15551234567"
        },
        "phone_number": "+15559876543"
      },
      "attachments": [],
      "metadata": {}
    }
  }'
```

## Step 3: Deploy to Supabase

```bash
# Link to your Supabase project
supabase link --project-ref your-project-ref

# Set secrets
supabase secrets set SURGE_API_TOKEN=your-token
supabase secrets set SURGE_ACCOUNT_ID=acct_your-id
supabase secrets set SURGE_PHONE_NUMBER=+15551234567
supabase secrets set SURGE_SIGNING_SECRET=your-secret

# Deploy the function
supabase functions deploy sms-agent
```

## Step 4: Configure Surge Webhook

1. Go to [Surge Dashboard](https://app.surge.app)
2. Navigate to **Phone Numbers** → Select your number
3. Go to **Webhooks** section
4. Add webhook:
   - **URL**: `https://<project-ref>.supabase.co/functions/v1/sms-agent`
   - **Events**: Select `message.received`
5. Copy the **Signing Secret** and update your Supabase secrets

## Step 5: Test End-to-End

Send a text message to your Surge phone number. Check the Supabase function logs:

```bash
supabase functions logs sms-agent
```

You should see:
```
=== INCOMING WEBHOOK ===
=== MESSAGE RECEIVED ===
From: +15551234567
Message: Your test message
========================
=== SEND SMS (STUB) ===
```

## Next Steps

1. Enable actual SMS sending by uncommenting the `sendSMS` function body
2. Add database storage for conversation history
3. Implement your agent logic in the message processing section
