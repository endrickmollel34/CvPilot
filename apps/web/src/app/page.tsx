import Link from 'next/link';
import { SignedIn, SignedOut } from '@clerk/nextjs';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold tracking-tight">CVPilot — Your AI Career Co-Pilot</h1>
      <p className="mt-4 text-lg text-gray-600">
        Score your CV against any job description in seconds.
      </p>
      <div className="mt-8 flex gap-4">
        <SignedOut>
          <Link
            href="/sign-up"
            className="rounded-md bg-black px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Analyse My CV Free
          </Link>
          <Link
            href="/sign-in"
            className="rounded-md border px-6 py-3 text-sm font-semibold hover:bg-gray-50"
          >
            Sign In
          </Link>
        </SignedOut>
        <SignedIn>
          <Link
            href="/dashboard"
            className="rounded-md bg-black px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800"
          >
            Go to Dashboard
          </Link>
        </SignedIn>
      </div>
    </main>
  );
}
