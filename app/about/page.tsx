import Link from "next/link";

export default function About() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 md:p-24">
      <div className="z-10 max-w-4xl w-full">
        <div className="mb-8">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
          >
            &larr; Back to Home
          </Link>
        </div>

        <h1 className="text-4xl md:text-5xl font-bold mb-6">About HeadsUp</h1>

        <div className="prose prose-lg dark:prose-invert max-w-none">
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            HeadsUp is an SMS-powered research assistant that helps you walk into
            meetings prepared. Text us the name of the person you&apos;re about
            to meet, and we&apos;ll deliver an instant briefing right to your
            phone.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">How It Works</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>
              You send an SMS with the person&apos;s name and any details you
              know (company, role, location)
            </li>
            <li>
              If we need more info, we&apos;ll ask a quick follow-up question
            </li>
            <li>
              We search the web for their background, career, recent news, and
              more
            </li>
            <li>
              Our AI compiles a concise briefing with key facts and conversation
              starters
            </li>
            <li>You receive the briefing via SMS, ready for your meeting</li>
          </ol>

          <h2 className="text-2xl font-semibold mt-8 mb-4">Tech Stack</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>
              <strong>Next.js 14</strong> - React framework with App Router and
              API routes
            </li>
            <li>
              <strong>Surge SMS</strong> - SMS API for sending and receiving text
              messages
            </li>
            <li>
              <strong>Tavily</strong> - AI-powered web search for gathering
              person information
            </li>
            <li>
              <strong>Anthropic Claude</strong> - LLM for conversation
              management and report generation
            </li>
            <li>
              <strong>TypeScript</strong> - Full type safety across the codebase
            </li>
            <li>
              <strong>Tailwind CSS</strong> - Utility-first styling
            </li>
          </ul>

          <h2 className="text-2xl font-semibold mt-8 mb-4">Architecture</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>
              SMS messages are received via Surge webhooks at{" "}
              <code className="text-sm bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                /api/webhooks/surge
              </code>
            </li>
            <li>
              A conversation manager tracks state per phone number
              (gathering info, researching, complete)
            </li>
            <li>
              Claude parses each message to extract person details and decide
              when enough info has been gathered
            </li>
            <li>
              Tavily searches the web with an optimized query built from the
              person&apos;s details
            </li>
            <li>
              Claude generates a concise, SMS-friendly briefing from the search
              results
            </li>
            <li>The briefing is sent back to the user via Surge SMS</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
