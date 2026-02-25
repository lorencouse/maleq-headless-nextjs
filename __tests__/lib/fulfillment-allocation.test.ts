import { buildFulfillmentPlan } from '@/lib/fulfillment/allocation';
import type { ResolvedFulfillmentItem } from '@/lib/fulfillment/types';

function item(overrides: Partial<ResolvedFulfillmentItem>): ResolvedFulfillmentItem {
  return {
    productId: 1,
    variationId: undefined,
    name: 'Test Item',
    requestedQty: 1,
    source: 'stc,williams_trading',
    totalStock: 10,
    williamsAvailable: 10,
    stcAvailable: 10,
    williamsSku: 'WT-1',
    stcUpc: '111111111111',
    ...overrides,
  };
}

describe('buildFulfillmentPlan', () => {
  const enabled = { enableWilliams: true, enableStc: true };

  it('routes the full order to Williams when all lines are available there', () => {
    const plan = buildFulfillmentPlan(
      [
        item({ productId: 101, requestedQty: 2, williamsAvailable: 5, stcAvailable: 5 }),
        item({ productId: 102, requestedQty: 1, williamsAvailable: 3, stcAvailable: 3 }),
      ],
      enabled
    );

    expect(plan.strategy).toBe('williams_only');
    expect(plan.williamsLines).toHaveLength(2);
    expect(plan.stcLines).toHaveLength(0);
    expect(plan.backorderedLines).toHaveLength(0);
  });

  it('falls back to STC for the full order when Williams cannot fill at least one line', () => {
    const plan = buildFulfillmentPlan(
      [
        item({ productId: 201, requestedQty: 2, williamsAvailable: 1, stcAvailable: 5 }),
        item({ productId: 202, requestedQty: 1, williamsAvailable: 0, stcAvailable: 3 }),
      ],
      enabled
    );

    expect(plan.strategy).toBe('stc_only');
    expect(plan.williamsLines).toHaveLength(0);
    expect(plan.stcLines).toHaveLength(2);
    expect(plan.backorderedLines).toHaveLength(0);
  });

  it('splits Williams-first then STC remainder when neither warehouse can fill the order alone', () => {
    const plan = buildFulfillmentPlan(
      [
        item({ productId: 301, requestedQty: 4, williamsAvailable: 3, stcAvailable: 2 }),
        item({ productId: 302, requestedQty: 3, williamsAvailable: 1, stcAvailable: 5 }),
      ],
      enabled
    );

    expect(plan.strategy).toBe('split');
    expect(plan.williamsLines.map((line) => line.quantity)).toEqual([3, 1]);
    expect(plan.stcLines.map((line) => line.quantity)).toEqual([1, 2]);
    expect(plan.backorderedLines).toHaveLength(0);
  });

  it('backorders remaining quantity after Williams-first and STC fallback are exhausted', () => {
    const plan = buildFulfillmentPlan(
      [
        item({ productId: 401, requestedQty: 5, williamsAvailable: 2, stcAvailable: 1 }),
      ],
      enabled
    );

    expect(plan.strategy).toBe('split');
    expect(plan.williamsLines[0].quantity).toBe(2);
    expect(plan.stcLines[0].quantity).toBe(1);
    expect(plan.backorderedLines).toHaveLength(1);
    expect(plan.backorderedLines[0].backorderedQty).toBe(2);
  });
});
