import { Skeleton, AccountSidebarSkeleton } from '@/components/ui/Skeleton';

export default function AccountLoading() {
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
          <div className="bg-card border border-border rounded-xl p-6">
            <Skeleton className="h-8 w-40 mb-6" />
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <Skeleton className="h-6 w-32" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
              <div className="space-y-4">
                <Skeleton className="h-6 w-32" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
