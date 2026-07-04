import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'wouter'

import { useAuth } from '@/auth'
import type { BusinessPartner, Product, Storage } from '@/local-db'
import { isDemoWorkspace } from '@/demo/demoConfig'
import {
  getDemoTutorialTaskDefinition,
  resolveDemoTutorialRoute,
} from './demoTutorialDefinitions'
import {
  readDemoTutorialState,
  saveDemoTutorialState,
} from './demoTutorialState'
import type {
  DemoOrderTutorialType,
  DemoTutorialProgress,
  DemoTutorialTaskId,
} from './demoTutorialTypes'
import { DemoTutorialOverlay } from './DemoTutorialOverlay'
import { DemoOrderTypeChoiceModal } from './DemoOrderTypeChoiceModal'

type DemoTutorialContextValue = {
  state: DemoTutorialProgress | null
  isLoaded: boolean
  isActive: boolean
  isAdvancedActive: boolean
  currentTask: DemoTutorialTaskId | null
  currentTaskDefinition: ReturnType<typeof getDemoTutorialTaskDefinition>
  goToCurrentTask: () => void
  finishTutorial: () => void
  completeStorageCreated: (storage: Pick<Storage, 'id' | 'name'>) => void
  completeProductCreated: (product: Pick<Product, 'id' | 'name'>) => void
  recordPosSaleCreated: (saleId: string) => void
  completePosSuccessModal: () => void
  completeSalesHistoryView: () => void
  completeSaleReturned: () => void
  completeBusinessPartnerCreated: (partner: Pick<BusinessPartner, 'id' | 'name'>) => void
  selectOrderType: (type: DemoOrderTutorialType) => void
  completeOrderCreated: (orderId: string, type?: DemoOrderTutorialType) => void
  isCurrentTask: (taskId: DemoTutorialTaskId) => boolean
}

const noop = () => undefined

const DemoTutorialContext = createContext<DemoTutorialContextValue>({
  state: null,
  isLoaded: false,
  isActive: false,
  isAdvancedActive: false,
  currentTask: null,
  currentTaskDefinition: null,
  goToCurrentTask: noop,
  finishTutorial: noop,
  completeStorageCreated: noop,
  completeProductCreated: noop,
  recordPosSaleCreated: noop,
  completePosSuccessModal: noop,
  completeSalesHistoryView: noop,
  completeSaleReturned: noop,
  completeBusinessPartnerCreated: noop,
  selectOrderType: noop,
  completeOrderCreated: noop,
  isCurrentTask: () => false,
})

function routeMatches(location: string, route: string) {
  if (route === '/') return location === '/'
  return location === route || location.startsWith(`${route}/`)
}

export function DemoTutorialProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [location, navigate] = useLocation()
  const [state, setState] = useState<DemoTutorialProgress | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const workspaceId = user?.workspaceId
  const isDemoUser = user?.workspaceMode === 'demo' || isDemoWorkspace(user?.workspaceCode)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoaded(false)
      if (!workspaceId || !isDemoUser) {
        setState(null)
        setIsLoaded(true)
        return
      }

      const loadedState = await readDemoTutorialState(workspaceId)
      const normalizedState = loadedState?.status === 'active' && loadedState.currentTask === 'return-sale'
        ? { ...loadedState, currentTask: 'sales-history' as const }
        : loadedState
      if (!cancelled) {
        setState(normalizedState)
        setIsLoaded(true)
        if (normalizedState && normalizedState !== loadedState) {
          void saveDemoTutorialState(normalizedState)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [isDemoUser, workspaceId])

  const persist = useCallback((updater: (current: DemoTutorialProgress) => DemoTutorialProgress) => {
    setState((current) => {
      if (!current) return current
      const next = updater(current)
      void saveDemoTutorialState(next)
      return next
    })
  }, [])

  const isActive = state?.status === 'active'
  const isAdvancedActive = isActive && state?.mode === 'advanced'
  const currentTask = state?.currentTask ?? null
  const currentTaskDefinition = useMemo(
    () => getDemoTutorialTaskDefinition(currentTask),
    [currentTask]
  )

  const goToCurrentTask = useCallback(() => {
    const route = resolveDemoTutorialRoute(state)
    if (route && !routeMatches(location, route)) {
      navigate(route)
    }
  }, [location, navigate, state])

  useEffect(() => {
    if (!isActive || !state) return
    if (state.currentTask === 'complete' || state.currentTask === 'basic-overview') return
    const route = resolveDemoTutorialRoute(state)
    if (route && !routeMatches(location, route)) {
      navigate(route)
    }
  }, [isActive, location, navigate, state])

  const finishTutorial = useCallback(() => {
    persist((current) => ({
      ...current,
      status: 'completed',
      currentTask: null,
      completedAt: new Date().toISOString(),
    }))
  }, [persist])

  const completeStorageCreated = useCallback((storage: Pick<Storage, 'id' | 'name'>) => {
    persist((current) => {
      if (current.mode !== 'advanced' || current.currentTask !== 'storage') return current
      return {
        ...current,
        storageId: storage.id,
        storageName: storage.name,
        currentTask: 'product',
      }
    })
  }, [persist])

  const completeProductCreated = useCallback((product: Pick<Product, 'id' | 'name'>) => {
    persist((current) => {
      if (current.mode !== 'advanced' || current.currentTask !== 'product') return current
      return {
        ...current,
        productId: product.id,
        productName: product.name,
        currentTask: 'pos-sale',
      }
    })
  }, [persist])

  const recordPosSaleCreated = useCallback((saleId: string) => {
    persist((current) => {
      if (current.mode !== 'advanced' || current.currentTask !== 'pos-sale') return current
      return {
        ...current,
        saleId,
      }
    })
  }, [persist])

  const completePosSuccessModal = useCallback(() => {
    persist((current) => {
      if (current.mode !== 'advanced' || current.currentTask !== 'pos-sale' || !current.saleId) return current
      return {
        ...current,
        currentTask: 'sales-history',
      }
    })
  }, [persist])

  const completeSalesHistoryView = useCallback(() => {
    persist((current) => {
      if (current.mode !== 'advanced' || current.currentTask !== 'sales-history') return current
      return current
    })
  }, [persist])

  const completeSaleReturned = useCallback(() => {
    persist((current) => {
      if (
        current.mode !== 'advanced'
        || (current.currentTask !== 'sales-history' && current.currentTask !== 'return-sale')
      ) return current
      return {
        ...current,
        currentTask: 'business-partner',
      }
    })
  }, [persist])

  const completeBusinessPartnerCreated = useCallback((partner: Pick<BusinessPartner, 'id' | 'name'>) => {
    persist((current) => {
      if (current.mode !== 'advanced' || current.currentTask !== 'business-partner') return current
      return {
        ...current,
        businessPartnerId: partner.id,
        businessPartnerName: partner.name,
        currentTask: 'order-choice',
      }
    })
  }, [persist])

  const selectOrderType = useCallback((type: DemoOrderTutorialType) => {
    persist((current) => {
      if (current.mode !== 'advanced' || current.currentTask !== 'order-choice') return current
      return {
        ...current,
        orderType: type,
        currentTask: 'order-form',
      }
    })
    navigate(type === 'purchase' ? '/orders/new/purchase' : '/orders/new/sales')
  }, [navigate, persist])

  const completeOrderCreated = useCallback((orderId: string, type?: DemoOrderTutorialType) => {
    persist((current) => {
      if (current.mode !== 'advanced' || current.currentTask !== 'order-form') return current
      return {
        ...current,
        orderId,
        orderType: type ?? current.orderType,
        currentTask: 'complete',
      }
    })
  }, [persist])

  const isCurrentTask = useCallback(
    (taskId: DemoTutorialTaskId) => isActive && currentTask === taskId,
    [currentTask, isActive]
  )

  const value = useMemo<DemoTutorialContextValue>(() => ({
    state,
    isLoaded,
    isActive,
    isAdvancedActive,
    currentTask,
    currentTaskDefinition,
    goToCurrentTask,
    finishTutorial,
    completeStorageCreated,
    completeProductCreated,
    recordPosSaleCreated,
    completePosSuccessModal,
    completeSalesHistoryView,
    completeSaleReturned,
    completeBusinessPartnerCreated,
    selectOrderType,
    completeOrderCreated,
    isCurrentTask,
  }), [
    completeBusinessPartnerCreated,
    completeOrderCreated,
    completePosSuccessModal,
    completeProductCreated,
    completeSaleReturned,
    completeSalesHistoryView,
    completeStorageCreated,
    currentTask,
    currentTaskDefinition,
    finishTutorial,
    goToCurrentTask,
    isActive,
    isAdvancedActive,
    isCurrentTask,
    isLoaded,
    recordPosSaleCreated,
    selectOrderType,
    state,
  ])

  return (
    <DemoTutorialContext.Provider value={value}>
      {children}
      <DemoTutorialOverlay />
      <DemoOrderTypeChoiceModal />
    </DemoTutorialContext.Provider>
  )
}

export function useDemoTutorial() {
  return useContext(DemoTutorialContext)
}
