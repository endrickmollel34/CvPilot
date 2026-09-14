import { SidebarNav } from '@/components/nav/SidebarNav';
import { MobileNav } from '@/components/nav/MobileNav';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-50 lg:flex-row">
      <SidebarNav />
      <MobileNav />
      <main className="w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
    </div>
  );
}
