import type { ComponentType } from 'react';
import { LayoutDashboard, FileText, BarChart3, Mail } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  exact: boolean;
}

// Single source of truth for the authenticated app's primary navigation —
// shared by the permanent desktop sidebar (SidebarNav) and the mobile
// hamburger drawer (MobileNav) so the two never drift out of sync.
export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard, exact: true },
  { href: '/cvs', label: 'My CVs', Icon: FileText, exact: false },
  { href: '/analyze', label: 'Analyse CV', Icon: BarChart3, exact: false },
  { href: '/cover-letter', label: 'Cover Letter', Icon: Mail, exact: false },
];

export function isNavItemActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + '/');
}
