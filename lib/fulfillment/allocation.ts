import type {
  FulfillmentPlan,
  FulfillmentStrategy,
  ResolvedFulfillmentItem,
} from './types';

interface AllocationOptions {
  enableWilliams: boolean;
  enableStc: boolean;
}

function canFillEntireOrderWithWilliams(
  items: ResolvedFulfillmentItem[],
  options: AllocationOptions
): boolean {
  if (!options.enableWilliams) return false;
  return items.every(
    (item) =>
      Boolean(item.williamsSku) && item.williamsAvailable >= item.requestedQty
  );
}

function canFillEntireOrderWithStc(
  items: ResolvedFulfillmentItem[],
  options: AllocationOptions
): boolean {
  if (!options.enableStc) return false;
  return items.every(
    (item) => Boolean(item.stcUpc) && item.stcAvailable >= item.requestedQty
  );
}

function strategyFromUsage(
  usedWilliams: boolean,
  usedStc: boolean
): FulfillmentStrategy {
  if (usedWilliams && usedStc) return 'split';
  if (usedWilliams) return 'williams_only';
  if (usedStc) return 'stc_only';
  return 'unallocated';
}

export function buildFulfillmentPlan(
  items: ResolvedFulfillmentItem[],
  options: AllocationOptions
): FulfillmentPlan {
  if (items.length === 0) {
    return {
      strategy: 'unallocated',
      allocations: [],
      williamsLines: [],
      stcLines: [],
      backorderedLines: [],
    };
  }

  const allWilliams = canFillEntireOrderWithWilliams(items, options);
  const allStc = canFillEntireOrderWithStc(items, options);

  let allocations = items.map((item) => ({
    productId: item.productId,
    variationId: item.variationId,
    name: item.name,
    requestedQty: item.requestedQty,
    williamsQty: 0,
    stcQty: 0,
    backorderedQty: item.requestedQty,
    williamsSku: item.williamsSku,
    stcUpc: item.stcUpc,
  }));

  if (allWilliams) {
    allocations = allocations.map((line) => ({
      ...line,
      williamsQty: line.requestedQty,
      backorderedQty: 0,
    }));
  } else if (allStc) {
    allocations = allocations.map((line) => ({
      ...line,
      stcQty: line.requestedQty,
      backorderedQty: 0,
    }));
  } else {
    allocations = allocations.map((line, idx) => {
      const item = items[idx];

      const williamsQty =
        options.enableWilliams && item.williamsSku
          ? Math.min(item.requestedQty, item.williamsAvailable)
          : 0;

      const remainingAfterWilliams = item.requestedQty - williamsQty;
      const stcQty =
        options.enableStc && item.stcUpc
          ? Math.min(remainingAfterWilliams, item.stcAvailable)
          : 0;

      const backorderedQty = Math.max(
        item.requestedQty - williamsQty - stcQty,
        0
      );

      return {
        ...line,
        williamsQty,
        stcQty,
        backorderedQty,
      };
    });
  }

  const usedWilliams = allocations.some((line) => line.williamsQty > 0);
  const usedStc = allocations.some((line) => line.stcQty > 0);
  const strategy = allWilliams
    ? 'williams_only'
    : allStc
      ? 'stc_only'
      : strategyFromUsage(usedWilliams, usedStc);

  const williamsLines = allocations
    .filter((line) => line.williamsQty > 0 && line.williamsSku)
    .map((line) => ({
      productId: line.productId,
      variationId: line.variationId,
      name: line.name,
      quantity: line.williamsQty,
      sku: line.williamsSku as string,
    }));

  const stcLines = allocations
    .filter((line) => line.stcQty > 0 && line.stcUpc)
    .map((line) => ({
      productId: line.productId,
      variationId: line.variationId,
      name: line.name,
      quantity: line.stcQty,
      sku: line.stcUpc as string,
    }));

  const backorderedLines = allocations.filter((line) => line.backorderedQty > 0);

  return {
    strategy,
    allocations,
    williamsLines,
    stcLines,
    backorderedLines,
  };
}
