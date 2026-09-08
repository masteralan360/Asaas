import type { StockBatchAllocation } from "./models";
import { adjustInventoryQuantity } from "./inventory";
import { commitStockBatchAllocations } from "./stockBatches";

export interface OfflinePosStockItem {
  productId: string;
  storageId: string;
  quantity: number;
}

export interface OfflinePosBatchPlan {
  productId: string;
  storageId: string;
  allocations: StockBatchAllocation[];
}

export async function applyOfflinePosStockEffects(input: {
  workspaceId: string;
  items: OfflinePosStockItem[];
  batchPlans: OfflinePosBatchPlan[];
  timestamp: string;
}) {
  await Promise.all(input.items.map((item) => adjustInventoryQuantity({
    workspaceId: input.workspaceId,
    productId: item.productId,
    storageId: item.storageId,
    quantityDelta: -item.quantity,
    timestamp: input.timestamp,
    // The complete_sale RPC is the sole cloud stock operation. These writes
    // are the optimistic local projection shown while the device is offline.
    skipRemoteHydration: true,
    skipRemoteSync: true,
  })));

  await Promise.all(input.batchPlans.map((plan) => commitStockBatchAllocations(
    input.workspaceId,
    plan.productId,
    plan.storageId,
    plan.allocations,
    {
      timestamp: input.timestamp,
      skipRemoteSync: true,
    },
  )));
}
