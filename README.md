# HeadsUp

An SMS-powered person research assistant. Text us the name of who you're about to meet and get an instant briefing delivered to your phone.

## How It Works

1. **Text** the HeadsUp number with the person's name and any details you know
2. **AI researches** their background, role, recent news, and more
3. **Receive a briefing** via SMS with key facts and conversation starters

## Tech Stack

- **Next.js 14** (App Router) - Frontend + API routes
- **Surge SMS** (`@surgeapi/node`) - Send and receive SMS messages
- **Tavily** (`@tavily/core`) - AI-powered web search
- **Anthropic Claude** (`@anthropic-ai/sdk`) - Conversation management + report generation
- **TypeScript** - Full type safety
- **Tailwind CSS** - Styling

## Project Structure

```
HeadsUp/
├── app/
│   ├── api/webhooks/surge/
│   │   └── route.ts          # Surge webhook endpoint
│   ├── about/page.tsx         # About page
│   ├── globals.css            # Global styles
│   ├── layout.tsx             # Root layout
│   └── page.tsx               # Home page
├── lib/
│   ├── anthropic.ts           # Claude client (parseIntent + generateReport)
│   ├── conversation.ts        # In-memory conversation state manager
│   ├── research.ts            # Research orchestrator pipeline
│   ├── surge.ts               # Surge SMS client (sendSMS helper)
│   └── tavily.ts              # Tavily web search client
├── components/
│   └── Navbar.tsx             # Navigation component
├── .env.local.example         # Required environment variables
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.js
```

## Getting Started

### Prerequisites

- Node.js 18+
- API keys for: [Surge](https://surge.app), [Tavily](https://tavily.com), [Anthropic](https://console.anthropic.com)

### Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the example env file and add your API keys:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` with your keys:

```
SURGE_API_KEY=your_surge_api_key
SURGE_ACCOUNT_ID=your_surge_account_id
SURGE_WEBHOOK_SECRET=your_surge_webhook_signing_secret
TAVILY_API_KEY=your_tavily_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

3. Run the development server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) to see the landing page.

### Webhook Setup

For Surge to send incoming SMS messages to your app:

1. Deploy the app or use a tunnel (e.g., ngrok) to expose your local server
2. In the [Surge dashboard](https://hq.surge.app), register your webhook URL:
   ```
   https://your-domain.com/api/webhooks/surge
   ```
3. Subscribe to the `message.received` event
4. Copy the webhook signing secret to your `.env.local` as `SURGE_WEBHOOK_SECRET`

### Testing

Send an SMS to your Surge phone number:

> "I'm about to meet Jane Doe, VP of Engineering at TechCorp in Austin"

You should receive a researched briefing back within seconds.

## Architecture

```
User SMS → Surge → POST /api/webhooks/surge → Conversation Manager
  → Claude (parse intent, extract person details)
  → If need more info: ask follow-up via SMS
  → If ready: Tavily web search → Claude report generation → SMS reply
```

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## License

MIT
