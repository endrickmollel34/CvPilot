'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { LayoutDashboard, FileText, BarChart3, Mail, Plus } from 'lucide-react';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard, exact: true },
  { href: '/cvs', label: 'My CVs', Icon: FileText, exact: false },
  { href: '/analyze', label: 'Analyse CV', Icon: BarChart3, exact: false },
  { href: '/cover-letter', label: 'Cover Letter', Icon: Mail, exact: false },
];

export function SidebarNav() {
  const pathname = usePathname();

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
      {/* Brand */}
      <div className="flex h-14 items-center border-b border-gray-200 px-4">
        <Link href="/dashboard" className="text-base font-bold tracking-tight text-gray-900">
          CVPilot
        </Link>
      </div>

      {/* Primary nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
        {NAV.map(({ href, label, Icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
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
          className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        >
          <Plus className="h-4 w-4 shrink-0" />
          New CV
        </Link>
      </nav>

      {/* User */}
      <div className="flex items-center gap-3 border-t border-gray-200 px-4 py-3">
        <UserButton />
        <span className="text-xs text-gray-500">Account</span>
      </div>
    </aside>
  );
}
