import { Skeleton, AccountSidebarSkeleton, OrderHistorySkeleton } from '@/components/ui/Skeleton';

export default function OrdersLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Skeleton className="h-10 w-48 mb-8" />

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <aside className="w-full md:w-64">
          <AccountSidebarSkeleton />
        </aside>

        {/* Main Content */}
        <main className="flex-1">
          <Skeleton className="h-8 w-40 mb-6" />
          <OrderHistorySkeleton />
        </main>
      </div>
    </div>
  );
}
