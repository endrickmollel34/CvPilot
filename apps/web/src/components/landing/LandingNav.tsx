'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Show } from '@clerk/nextjs';
import {
  ChevronDown,
  LayoutTemplate,
  ListChecks,
  Mail,
  Menu,
  Target,
  Upload,
  Wand2,
  X,
} from 'lucide-react';

// Anchor targets, not routes — every one of these lives on this same
// homepage (see the section ids in page.tsx's own component tree). Using
// next/link with a hash href still performs same-page, JS-free browser
// anchor navigation; it never triggers a full route change.
const NAV_LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

// Real, already-implemented CVPilot capabilities only (mirrors the feature
// set in Features.tsx — no aspirational items). There is no dedicated route
// per feature today, so every entry deep-links to the same `#features`
// section; this menu is a richer preview of that section, not a new IA.
const FEATURES_MENU = [
  {
    Icon: LayoutTemplate,
    label: 'CV Builder',
    description: 'Build a structured, ATS-friendly CV from scratch.',
  },
  {
    Icon: Target,
    label: 'AI CV Analysis',
    description: 'Get an instant match score with actionable feedback.',
  },
  {
    Icon: Wand2,
    label: 'Job Tailoring',
    description: 'Adapt your CV to a specific role in one click.',
  },
  {
    Icon: Mail,
    label: 'Cover Letters',
    description: 'Generate a personalised cover letter for any job.',
  },
  {
    Icon: Upload,
    label: 'CV Upload / Parsing',
    description: 'Upload a PDF or DOCX — we extract the details.',
  },
  {
    Icon: ListChecks,
    label: 'ATS / Job Match',
    description: 'See how your CV reads to an applicant tracking system.',
  },
] as const;

function FeaturesMenu({
  open,
  onOpen,
  onScheduleClose,
  onKeyDown,
  onClose,
  triggerId,
  panelId,
}: {
  open: boolean;
  onOpen: () => void;
  onScheduleClose: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onClose: () => void;
  triggerId: string;
  panelId: string;
}) {
  const triggerRef = useRef<HTMLAnchorElement>(null);

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      onClose();
    }
  };

  return (
    <div
      className="relative"
      onMouseEnter={onOpen}
      onMouseLeave={onScheduleClose}
      onFocus={onOpen}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        onKeyDown(e);
        if (e.key === 'Escape') triggerRef.current?.focus();
      }}
    >
      <Link
        id={triggerId}
        ref={triggerRef}
        href="#features"
        className="flex items-center gap-1 text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={panelId}
      >
        Features
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${
            open ? 'rotate-180' : ''
          }`}
        />
      </Link>

      {/* Floating mega-menu: restrained fade + small translate only, no
          bounce/overshoot easing. Always mounted (not conditionally
          rendered) so both open and close animate smoothly; visibility is
          governed purely by opacity/pointer-events/aria-hidden, and menu
          items are only real tab stops while open. */}
      <div
        id={panelId}
        role="menu"
        aria-hidden={!open}
        className={`absolute left-1/2 top-full z-50 w-[34rem] max-w-[calc(100vw-3.5rem)] -translate-x-1/2 pt-3 transition-all duration-200 ease-out motion-reduce:!translate-y-0 motion-reduce:transition-none ${
          open
            ? 'translate-y-0 opacity-100 pointer-events-auto'
            : '-translate-y-1 opacity-0 pointer-events-none'
        }`}
      >
        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-neutral-200/70 bg-white/95 p-3 shadow-[0_1px_2px_rgba(15,15,20,0.04),0_24px_48px_-16px_rgba(15,15,20,0.22)] backdrop-blur-xl">
          {FEATURES_MENU.map(({ Icon, label, description }) => (
            <Link
              key={label}
              href="#features"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={onClose}
              className="flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-neutral-50"
            >
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-neutral-900">{label}</span>
                <span className="mt-0.5 block text-xs leading-snug text-neutral-500">
                  {description}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LandingNav() {
  const [open, setOpen] = useState(false);
  const [mobileFeaturesOpen, setMobileFeaturesOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Subtle premium treatment: an almost-invisible glass bar over the hero,
  // gaining a touch more opacity/blur and a hairline shadow once the page
  // has scrolled past it — a small, standard SaaS-navbar behaviour, not a
  // decorative animation.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(
    () => () => {
      if (closeTimeout.current) clearTimeout(closeTimeout.current);
    },
    [],
  );

  const openFeatures = () => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    setFeaturesOpen(true);
  };
  // A short delay (rather than closing instantly) is what makes the
  // interaction feel graceful when the pointer briefly leaves the trigger
  // en route to the panel, or leaves the whole group intentionally.
  const scheduleCloseFeatures = () => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    closeTimeout.current = setTimeout(() => setFeaturesOpen(false), 150);
  };
  const closeFeaturesNow = () => {
    if (closeTimeout.current) clearTimeout(closeTimeout.current);
    setFeaturesOpen(false);
  };
  const handleFeaturesKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && featuresOpen) {
      closeFeaturesNow();
    }
  };

  return (
    <nav
      className={`sticky top-0 z-50 border-b backdrop-blur-lg transition-colors duration-300 ${
        scrolled
          ? 'border-neutral-200/80 bg-white/85 shadow-sm shadow-neutral-900/5'
          : 'border-transparent bg-white/60'
      }`}
    >
      {/*
        3-column grid, not flex justify-between: with justify-between, the
        middle nav-links group only sits "between" the logo and the auth
        button — its visual centre shifts depending on how wide each of
        those is, which is exactly why it used to look squeezed toward the
        middle of the screen rather than centred on the row. [1fr_auto_1fr]
        gives the logo and auth column equal, independently-growing flexible
        space, so the auto-sized middle column is always mathematically
        centred on the full row regardless of side-content width — and a
        much wider row (max-w-[90rem], generous responsive edge padding)
        gives the logo and CTA real room to sit near the true left/right
        edges on large desktop screens instead of hugging a narrow centred
        column.
      */}
      <div className="mx-auto grid h-16 max-w-[90rem] grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 sm:px-8 lg:px-14">
        <Link
          href="/"
          className="flex items-center gap-2 justify-self-start text-lg font-bold tracking-tight text-neutral-900"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-extrabold text-white shadow-sm shadow-indigo-600/30">
            C
          </span>
          CVPilot
        </Link>

        <div className="col-start-2 hidden items-center gap-9 justify-self-center md:flex">
          {NAV_LINKS.map((link) =>
            link.href === '#features' ? (
              <FeaturesMenu
                key={link.href}
                open={featuresOpen}
                onOpen={openFeatures}
                onScheduleClose={scheduleCloseFeatures}
                onKeyDown={handleFeaturesKeyDown}
                onClose={closeFeaturesNow}
                triggerId="features-menu-trigger"
                panelId="features-menu-panel"
              />
            ) : (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900"
              >
                {link.label}
              </Link>
            ),
          )}
        </div>

        <div className="col-start-3 flex items-center justify-self-end">
          <div className="hidden items-center gap-3 md:flex">
            <Show when="signed-out">
              <Link
                href="/sign-in"
                className="text-sm font-medium text-neutral-600 hover:text-neutral-900"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-full bg-[#212121] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#262626]"
              >
                Get started free
              </Link>
            </Show>
            <Show when="signed-in">
              <Link
                href="/dashboard"
                className="rounded-full bg-[#212121] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#262626]"
              >
                Go to dashboard
              </Link>
            </Show>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
              setMobileFeaturesOpen(false);
            }}
            className="inline-flex items-center justify-center rounded-md p-2 text-neutral-700 md:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-neutral-100 bg-white px-6 py-4 md:hidden">
          <div className="flex flex-col gap-4">
            {NAV_LINKS.map((link) =>
              link.href === '#features' ? (
                // Mobile uses tap/click, never hover: the row itself is a
                // disclosure toggle, and each feature underneath is a real
                // link that navigates to the section and closes the menu.
                <div key={link.href}>
                  <button
                    type="button"
                    onClick={() => setMobileFeaturesOpen((v) => !v)}
                    aria-expanded={mobileFeaturesOpen}
                    aria-controls="mobile-features-menu"
                    className="flex w-full items-center justify-between text-sm font-medium text-neutral-700"
                  >
                    Features
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${
                        mobileFeaturesOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <div
                    id="mobile-features-menu"
                    className={`grid overflow-hidden transition-all duration-200 ease-out motion-reduce:transition-none ${
                      mobileFeaturesOpen
                        ? 'mt-3 grid-rows-[1fr] opacity-100'
                        : 'grid-rows-[0fr] opacity-0'
                    }`}
                  >
                    <div className="min-h-0 space-y-3.5 border-l border-neutral-100 pl-4">
                      {FEATURES_MENU.map(({ Icon, label, description }) => (
                        <Link
                          key={label}
                          href="#features"
                          onClick={() => setOpen(false)}
                          className="flex items-start gap-2.5"
                        >
                          <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-indigo-600" />
                          <span>
                            <span className="block text-sm font-medium text-neutral-800">
                              {label}
                            </span>
                            <span className="block text-xs text-neutral-500">{description}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-neutral-700"
                >
                  {link.label}
                </Link>
              ),
            )}
            <div className="mt-2 flex flex-col gap-3 border-t border-neutral-100 pt-4">
              <Show when="signed-out">
                <Link
                  href="/sign-in"
                  onClick={() => setOpen(false)}
                  className="text-sm font-medium text-neutral-700"
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up"
                  onClick={() => setOpen(false)}
                  className="rounded-full bg-[#212121] px-5 py-2.5 text-center text-sm font-semibold text-white"
                >
                  Get started free
                </Link>
              </Show>
              <Show when="signed-in">
                <Link
                  href="/dashboard"
                  onClick={() => setOpen(false)}
                  className="rounded-full bg-[#212121] px-5 py-2.5 text-center text-sm font-semibold text-white"
                >
                  Go to dashboard
                </Link>
              </Show>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
