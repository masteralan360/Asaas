import { PackagePlus, ShoppingCart } from 'lucide-react'
import { useLocation } from 'wouter'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/ui/components'
import { useDemoTutorial } from './DemoTutorialProvider'

export function DemoOrderTypeChoiceModal() {
  const [location] = useLocation()
  const { t } = useTranslation()
  const { isAdvancedActive, currentTask, selectOrderType } = useDemoTutorial()
  const isOpen = isAdvancedActive && currentTask === 'order-choice' && location.startsWith('/orders')

  return (
    <Dialog open={isOpen}>
      <DialogContent
        data-tour-id="tutorial-order-choice-modal"
        className="flex max-w-lg flex-col rounded-2xl p-0"
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b bg-muted/30 px-6 py-5 text-start">
          <DialogTitle className="flex items-center gap-2 text-xl">
            <ShoppingCart className="h-5 w-5 text-primary" />
            {t('demo.tutorial.orderChoiceModal.title', { defaultValue: 'Choose order type' })}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('demo.tutorial.orderChoiceModal.description', {
              defaultValue: 'Pick the order workflow you want to learn. The tutorial will open the matching form.',
            })}
          </p>
        </DialogHeader>

        <div className="grid gap-3 p-5 sm:grid-cols-2">
          <button
            type="button"
            data-tour-id="tutorial-order-choice-sales"
            className="rounded-2xl border border-border/70 bg-background p-4 text-start shadow-sm transition hover:border-primary/60 hover:bg-primary/5"
            onClick={() => selectOrderType('sales')}
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600">
              <ShoppingCart className="h-5 w-5" />
            </div>
            <div className="font-black">
              {t('demo.tutorial.orderChoiceModal.salesTitle', { defaultValue: 'New Sales Order' })}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('demo.tutorial.orderChoiceModal.salesDescription', {
                defaultValue: 'Use this when a customer orders products from the business.',
              })}
            </p>
          </button>

          <button
            type="button"
            data-tour-id="tutorial-order-choice-purchase"
            className="rounded-2xl border border-border/70 bg-background p-4 text-start shadow-sm transition hover:border-primary/60 hover:bg-primary/5"
            onClick={() => selectOrderType('purchase')}
          >
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600">
              <PackagePlus className="h-5 w-5" />
            </div>
            <div className="font-black">
              {t('demo.tutorial.orderChoiceModal.purchaseTitle', { defaultValue: 'New Purchase Order' })}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('demo.tutorial.orderChoiceModal.purchaseDescription', {
                defaultValue: 'Use this when the business purchases stock from a supplier.',
              })}
            </p>
          </button>
        </div>

        <div className="border-t bg-muted/20 px-5 py-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            data-tour-id="tutorial-order-choice-redirect"
            disabled
          >
            {t('demo.tutorial.orderChoiceModal.selectToContinue', { defaultValue: 'Select an order type to continue' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
