'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { Menu, Plus, X } from 'lucide-react';

import { NAV_ITEMS, isNavItemActive } from './navItems';

// Mobile/tablet equivalent of SidebarNav (hidden below `lg`): a sticky top
// bar with branding + a hamburger button that opens the same navigation as
// a closable drawer/overlay. Reuses NAV_ITEMS so the two never drift apart.
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // Close whenever the route changes (covers any navigation, not just a
  // click inside the drawer itself).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 lg:hidden">
        <Link href="/dashboard" className="text-base font-bold tracking-tight text-gray-900">
          CVPilot
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center justify-center rounded-md p-2 text-gray-600 hover:bg-gray-100"
          aria-expanded={open}
          aria-controls="mobile-dashboard-nav"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-black/30"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            id="mobile-dashboard-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="fixed inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 px-4">
              <span className="text-base font-bold tracking-tight text-gray-900">CVPilot</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex items-center justify-center rounded-md p-2 text-gray-600 hover:bg-gray-100"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
              {NAV_ITEMS.map(({ href, label, Icon, exact }) => {
                const active = isNavItemActive(pathname, href, exact);
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}

              <div className="my-2 border-t border-gray-100" />

              <Link
                href="/cvs/new"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              >
                <Plus className="h-4 w-4 shrink-0" />
                New CV
              </Link>
            </nav>

            <div className="flex items-center gap-3 border-t border-gray-200 px-4 py-3">
              <UserButton />
              <span className="text-xs text-gray-500">Account</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
