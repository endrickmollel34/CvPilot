import Link from 'next/link';

// Only real, existing routes/anchors — no fabricated social links.
const FOOTER_LINKS: Record<string, { href: string; label: string }[]> = {
  Product: [
    { href: '#features', label: 'Features' },
    { href: '#how-it-works', label: 'How it works' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#faq', label: 'FAQ' },
  ],
  Company: [{ href: '/contact', label: 'Contact' }],
  Legal: [
    { href: '/privacy', label: 'Privacy Policy' },
    { href: '/terms', label: 'Terms of Service' },
  ],
};

export function LandingFooter() {
  return (
    <footer className="relative overflow-hidden bg-[#181818] px-6 pb-10 pt-16 text-[#B4B4B4] lg:pt-20">
      {/* A deliberate seam separating this from FinalCta above, even though
          both are dark — signals an intentional closing section rather than
          an accidental colour repeat. Slate rather than indigo, so the
          accent colour stays reserved for real emphasis (buttons, scores,
          the brand mark) instead of being repeated as a generic line. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#5A5F7D]/50 to-transparent"
      />
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.3fr_0.7fr_0.7fr_0.7fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5 text-xl font-bold text-[#F7F7F7]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-extrabold text-white shadow-sm shadow-indigo-600/30">
                C
              </span>
              CVPilot
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[#B4B4B4]">
              AI-powered CV tools to help you build, tailor, and land more interviews.
            </p>
          </div>

          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading}>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[#B4B4B4]/70">
                {heading}
              </h3>
              <ul className="mt-5 space-y-3">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm transition-colors hover:text-[#F7F7F7]"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-8 text-xs text-[#B4B4B4]/60 sm:flex-row">
          <span>© 2026 CVPilot. All rights reserved.</span>
          <span>Helping you land more interviews.</span>
        </div>
      </div>
    </footer>
  );
}
