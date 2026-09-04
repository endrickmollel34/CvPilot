import Link from 'next/link';

interface Props {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

// Shared chrome for the public legal pages (/privacy, /terms) — deliberately
// reuses the homepage's nav/footer visual language (same palette, container
// width convention, border/typography choices) rather than introducing a new
// style, but is otherwise self-contained so it doesn't pull the marketing
// page's hero/pricing sections along with it.
export function LegalPageLayout({ title, lastUpdated, children }: Props) {
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

      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm text-neutral-400">Last updated: {lastUpdated}</p>

        <div
          className="
            mt-10 space-y-8 text-[15px] leading-relaxed text-neutral-700
            [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-neutral-900
            [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-neutral-900
            [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5
            [&_a]:text-neutral-900 [&_a]:underline [&_a]:underline-offset-2
            [&_strong]:font-semibold [&_strong]:text-neutral-900
          "
        >
          {children}
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
