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
            ← Back to Home
          </Link>
        </div>

        <h1 className="text-4xl md:text-5xl font-bold mb-6">
          About This Project
        </h1>

        <div className="prose prose-lg dark:prose-invert max-w-none">
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            This is a Next.js application built with modern web technologies.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">Tech Stack</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li><strong>Next.js 14</strong> - React framework with App Router</li>
            <li><strong>TypeScript</strong> - Type-safe JavaScript</li>
            <li><strong>Tailwind CSS</strong> - Utility-first CSS framework</li>
            <li><strong>React 18</strong> - Latest React features</li>
          </ul>

          <h2 className="text-2xl font-semibold mt-8 mb-4">Features</h2>
          <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-300">
            <li>Server-side rendering (SSR)</li>
            <li>Static site generation (SSG)</li>
            <li>API routes</li>
            <li>Dark mode support</li>
            <li>Responsive design</li>
            <li>Fast refresh development</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
