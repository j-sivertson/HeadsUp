import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 md:p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <div className="flex flex-col items-center gap-8">
          <h1 className="text-4xl md:text-6xl font-bold text-center bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Welcome to HeadsUp
          </h1>
          
          <p className="text-lg md:text-xl text-center text-gray-600 dark:text-gray-300 max-w-2xl">
            A modern Next.js application built with TypeScript and Tailwind CSS
          </p>

          <div className="flex flex-col sm:flex-row gap-4 mt-8">
            <Link
              href="/about"
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium"
            >
              Learn More
            </Link>
            <a
              href="https://nextjs.org/docs"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors duration-200 font-medium text-center"
            >
              Next.js Docs
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12 w-full max-w-4xl">
            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow">
              <h2 className="text-xl font-semibold mb-2">⚡ Fast</h2>
              <p className="text-gray-600 dark:text-gray-400">
                Built with Next.js for optimal performance and SEO
              </p>
            </div>
            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow">
              <h2 className="text-xl font-semibold mb-2">🎨 Modern</h2>
              <p className="text-gray-600 dark:text-gray-400">
                Beautiful UI with Tailwind CSS and responsive design
              </p>
            </div>
            <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg transition-shadow">
              <h2 className="text-xl font-semibold mb-2">🔒 Type Safe</h2>
              <p className="text-gray-600 dark:text-gray-400">
                Full TypeScript support for better developer experience
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
