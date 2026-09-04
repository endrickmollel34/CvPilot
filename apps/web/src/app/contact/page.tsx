import type { Metadata } from 'next';
import Link from 'next/link';

import { ContactForm } from '@/components/contact/ContactForm';

export const metadata: Metadata = {
  title: 'Contact — CVPilot',
  description: 'Get in touch with CVPilot for support, billing, privacy, or general questions.',
};

// Public page — must work for signed-out visitors (see middleware.ts's
// isPublicRoute list) since it's the only contact route linked from the
// Privacy Policy and Terms of Service, which are themselves reachable
// without an account.
export default function ContactPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <nav className="sticky top-0 z-10 border-b border-neutral-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-bold tracking-tight">
            CVPilot
          </Link>
          <Link href="/" className="text-sm text-neutral-600 hover:text-neutral-900">
            ← Back to CVPilot
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight">Contact us</h1>
        <p className="mt-3 text-sm text-neutral-500">
          Questions, feedback, billing issues, or a privacy/data request — send us a message and
          we&apos;ll get back to you.
        </p>

        <div className="mt-10">
          <ContactForm />
        </div>
      </main>

      <footer className="border-t border-neutral-100 px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 text-sm text-neutral-400 sm:flex-row">
          <span>© 2026 CVPilot</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-neutral-600">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-neutral-600">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
