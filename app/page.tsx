export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 md:p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between text-sm">
        <div className="flex flex-col items-center gap-8">
          {/* Hero */}
          <h1 className="text-4xl md:text-6xl font-bold text-center bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            HeadsUp
          </h1>

          <p className="text-lg md:text-xl text-center text-gray-600 dark:text-gray-300 max-w-2xl">
            Walk into every meeting prepared. Text us the name of who
            you&apos;re about to meet and get an instant briefing delivered
            straight to your phone.
          </p>

          {/* How it works */}
          <div className="w-full max-w-3xl mt-8">
            <h2 className="text-2xl font-semibold text-center mb-8">
              How It Works
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-300 text-xl font-bold">
                  1
                </div>
                <h3 className="font-semibold text-lg">Text Us</h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Send an SMS with the name and details of the person
                  you&apos;re about to meet.
                </p>
              </div>

              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-purple-600 dark:text-purple-300 text-xl font-bold">
                  2
                </div>
                <h3 className="font-semibold text-lg">We Research</h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Our AI scours the web to find their background, role, recent
                  news, and talking points.
                </p>
              </div>

              <div className="flex flex-col items-center text-center gap-3">
                <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 dark:text-green-300 text-xl font-bold">
                  3
                </div>
                <h3 className="font-semibold text-lg">Get Your Briefing</h3>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  Receive a concise person briefing via SMS within seconds, right
                  before your meeting.
                </p>
              </div>
            </div>
          </div>

          {/* Example */}
          <div className="w-full max-w-2xl mt-8 bg-gray-50 dark:bg-gray-900 rounded-xl p-6 border border-gray-200 dark:border-gray-800">
            <h3 className="font-semibold mb-4 text-center">Example</h3>
            <div className="space-y-3 font-mono text-sm">
              <div className="flex gap-3">
                <span className="text-blue-600 dark:text-blue-400 font-semibold shrink-0">
                  You:
                </span>
                <span className="text-gray-700 dark:text-gray-300">
                  &quot;Meeting John Smith, CTO at Acme Corp, based in SF&quot;
                </span>
              </div>
              <div className="flex gap-3">
                <span className="text-purple-600 dark:text-purple-400 font-semibold shrink-0">
                  HeadsUp:
                </span>
                <span className="text-gray-700 dark:text-gray-300">
                  &quot;Got it! Researching John Smith now. I&apos;ll have your
                  briefing in a moment...&quot;
                </span>
              </div>
              <div className="flex gap-3">
                <span className="text-purple-600 dark:text-purple-400 font-semibold shrink-0">
                  HeadsUp:
                </span>
                <span className="text-gray-700 dark:text-gray-300">
                  &quot;BRIEFING: John Smith - CTO at Acme Corp since 2021.
                  Previously VP Eng at BigTech. Stanford CS grad. Recently spoke
                  at TechCrunch Disrupt about AI infrastructure...&quot;
                </span>
              </div>
            </div>
          </div>

          {/* Feature cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8 w-full max-w-4xl">
            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow">
              <h2 className="text-xl font-semibold mb-2">SMS-Powered</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                No app to download. Just text the HeadsUp number from any phone
                and get results instantly.
              </p>
            </div>
            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow">
              <h2 className="text-xl font-semibold mb-2">AI-Researched</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Powered by web search and AI to compile the most relevant and
                up-to-date information.
              </p>
            </div>
            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow">
              <h2 className="text-xl font-semibold mb-2">Meeting-Ready</h2>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Briefings include background, highlights, recent news, and
                conversation starters.
              </p>
            </div>
          </div>

          {/* Tech footer */}
          <div className="mt-12 text-center text-xs text-gray-400 dark:text-gray-600">
            <p>
              Built with Next.js, Surge SMS, Tavily Search, and Anthropic
              Claude.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
