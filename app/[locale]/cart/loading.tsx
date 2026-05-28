import { Skeleton, CartItemSkeleton, OrderSummarySkeleton } from '@/components/ui/Skeleton';

export default function CartLoading() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <Skeleton className="h-10 w-48 mb-8" />

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Cart Items */}
        <div className="flex-1 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <CartItemSkeleton key={i} />
          ))}
        </div>

        {/* Order Summary */}
        <aside className="w-full lg:w-96">
          <OrderSummarySkeleton />
        </aside>
      </div>
    </div>
  );
}
