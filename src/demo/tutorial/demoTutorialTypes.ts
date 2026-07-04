import type { Product, Storage } from '@/local-db'

export type DemoTutorialMode = 'none' | 'basic' | 'advanced'

export type DemoTutorialStatus = 'inactive' | 'active' | 'completed'

export type DemoAdvancedTaskId =
  | 'storage'
  | 'product'
  | 'pos-sale'
  | 'sales-history'
  | 'return-sale'
  | 'business-partner'
  | 'order-choice'
  | 'order-form'
  | 'complete'

export type DemoTutorialTaskId = DemoAdvancedTaskId | 'basic-overview'

export type DemoOrderTutorialType = 'sales' | 'purchase'

export const DEMO_TUTORIAL_ADVANCED_MINUTES = 30

export interface DemoTutorialProgress {
  mode: DemoTutorialMode
  status: DemoTutorialStatus
  currentTask: DemoTutorialTaskId | null
  workspaceId: string
  advancedAutoGuide?: boolean
  storageId?: string
  storageName?: string
  productId?: string
  productName?: string
  saleId?: string
  businessPartnerId?: string
  businessPartnerName?: string
  orderType?: DemoOrderTutorialType
  orderId?: string
  startedAt: string
  completedAt?: string
}

export type DemoTutorialMarkerKind = 'mandatory' | 'overview'

export interface DemoTutorialMarker {
  id: string
  targetId: string
  label: string
  labelKey?: string
  description: string
  descriptionKey?: string
  kind: DemoTutorialMarkerKind
}

export interface DemoTutorialTaskDefinition {
  id: DemoTutorialTaskId
  title: string
  titleKey?: string
  description: string
  descriptionKey?: string
  route?: string | ((state: DemoTutorialProgress) => string | null)
  markers: DemoTutorialMarker[]
}

export type DemoTutorialCreatedProduct = Pick<Product, 'id' | 'name'>
export type DemoTutorialCreatedStorage = Pick<Storage, 'id' | 'name'>
