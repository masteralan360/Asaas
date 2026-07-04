import type {
  DemoTutorialMarker,
  DemoTutorialProgress,
  DemoTutorialTaskDefinition,
  DemoTutorialTaskId,
} from './demoTutorialTypes'

function markerTranslationId(id: string) {
  return id.replace(/\./g, '_')
}

function mandatory(id: string, targetId: string, label: string, description: string): DemoTutorialMarker {
  const key = markerTranslationId(id)
  return {
    id,
    targetId,
    label,
    labelKey: `demo.tutorial.markers.${key}.label`,
    description,
    descriptionKey: `demo.tutorial.markers.${key}.description`,
    kind: 'mandatory',
  }
}

function overview(id: string, targetId: string, label: string, description: string): DemoTutorialMarker {
  const key = markerTranslationId(id)
  return {
    id,
    targetId,
    label,
    labelKey: `demo.tutorial.markers.${key}.label`,
    description,
    descriptionKey: `demo.tutorial.markers.${key}.description`,
    kind: 'overview',
  }
}

function taskText(id: DemoTutorialTaskId, title: string, description: string) {
  return {
    title,
    titleKey: `demo.tutorial.tasks.${id}.title`,
    description,
    descriptionKey: `demo.tutorial.tasks.${id}.description`,
  }
}

export const DEMO_TUTORIAL_TASKS: DemoTutorialTaskDefinition[] = [
  {
    id: 'basic-overview',
    ...taskText('basic-overview', 'Basic Tutorial', 'A short orientation for the demo workspace.'),
    route: '/',
    markers: [
      overview('0.1', 'demo-basic-dashboard', 'Dashboard', 'Start from the dashboard and use the sidebar to explore modules.'),
    ],
  },
  {
    id: 'storage',
    ...taskText('storage', '1. Create Storage', 'Create a storage location for the product you will sell later.'),
    route: '/storages',
    markers: [
      mandatory('1.1', 'tutorial-storage-new-button', 'New Storage', 'Open the storage creation dialog.'),
      mandatory('1.2', 'tutorial-storage-name-input', 'Storage name', 'Enter a clear name for the storage.'),
      mandatory('1.3', 'tutorial-storage-save-button', 'Create storage', 'Save the storage to continue.'),
      overview('1.4', 'tutorial-storage-list', 'Storage list', 'Saved storages appear here with type, stock, and actions.'),
    ],
  },
  {
    id: 'product',
    ...taskText('product', '2. Create Product', 'Create a returnable product with stock so it can be sold in POS.'),
    route: '/products/new',
    markers: [
      mandatory('2.1', 'tutorial-product-name', 'Product name', 'Enter the product name.'),
      mandatory('2.2', 'tutorial-product-sku', 'Product SKU', 'Enter or confirm a SKU for tracking and search.'),
      overview('2.3', 'tutorial-product-unit', 'Unit selection', 'Units control how product quantities are counted and sold.'),
      mandatory('2.4', 'tutorial-product-storage', 'Storage', 'Select the storage created in the first task.'),
      mandatory('2.5', 'tutorial-product-price', 'Price', 'Enter the selling price.'),
      mandatory('2.6', 'tutorial-product-cost-price', 'Cost price', 'Enter the cost basis for profit tracking.'),
      overview('2.7', 'tutorial-product-currency', 'Currency', 'Currency controls product pricing and exchange behavior.'),
      mandatory('2.8', 'tutorial-product-initial-stock', 'Initial stock', 'Enter stock greater than 0 so POS can sell it.'),
      overview('2.9', 'tutorial-product-returnable', 'Return setting', 'Returnable products can be returned from Sales History.'),
      mandatory('2.10', 'tutorial-product-save', 'Save product', 'Save the product to continue.'),
    ],
  },
  {
    id: 'pos-sale',
    ...taskText('pos-sale', '3. Make POS Sale', 'Sell the product through POS. Loan stays visible but disabled in this tutorial.'),
    route: '/pos',
    markers: [
      mandatory('3.1', 'tutorial-pos-product-card', 'Product card', 'Select the product you created.'),
      overview('3.2', 'tutorial-pos-cart', 'Current sale', 'Selected products appear in the cart.'),
      overview('3.3', 'tutorial-pos-cart-quantity', 'Quantity controls', 'Use these controls to adjust cart quantity.'),
      mandatory('3.4', 'tutorial-pos-payment-area', 'Payment method', 'Choose Cash or Digital before checkout.'),
      overview('3.5', 'tutorial-pos-payment-cash', 'Cash', 'Cash is available during the tutorial.'),
      overview('3.6', 'tutorial-pos-payment-digital', 'Digital', 'Digital payment is available during the tutorial.'),
      overview('3.7', 'tutorial-pos-payment-loan', 'Loan', 'Loan remains visible, but is disabled for this tutorial.'),
      overview('3.8', 'tutorial-pos-digital-provider', 'Digital providers', 'If Digital is selected, choose the provider here.'),
      mandatory('3.9', 'tutorial-pos-checkout', 'Checkout', 'Complete the sale.'),
      mandatory('3.10', 'tutorial-pos-success-modal', 'Success modal', 'The sale is complete and ready for history.'),
      overview('3.11', 'tutorial-pos-print-receipt', 'Print receipt', 'Printing is visible but disabled in this tutorial.'),
      mandatory('3.12', 'tutorial-pos-success-continue', 'Continue', 'Close the success modal to move to Sales History.'),
    ],
  },
  {
    id: 'sales-history',
    ...taskText('sales-history', '4. Return Sale In Sales History', 'Find the POS sale and return it from Sales History.'),
    route: '/sales',
    markers: [
      mandatory('4.1', 'tutorial-sales-created-sale', 'Sale to return', 'This is the POS sale created in the previous task.'),
      mandatory('4.2', 'tutorial-return-sale-action', 'Return Sale', 'Use the return action now. Do not open View details for this tutorial.'),
      overview('4.3', 'tutorial-return-confirmation-modal', 'Return modal', 'The return flow confirms intent and captures reason.'),
      overview('4.4', 'tutorial-return-reason', 'Return reason', 'Pick a reason for the return if required.'),
      mandatory('4.5', 'tutorial-return-confirm-button', 'Confirm return', 'Confirm the sale return.'),
      mandatory('4.6', 'tutorial-returned-status', 'Returned status', 'The sale must show returned status before continuing.'),
    ],
  },
  {
    id: 'return-sale',
    ...taskText('return-sale', '5. Return That Sale', 'Return the exact sale created in POS.'),
    route: '/sales',
    markers: [
      mandatory('5.1', 'tutorial-return-sale-action', 'Return Sale', 'Open the return flow for the tutorial sale.'),
      overview('5.2', 'tutorial-return-confirmation-modal', 'Return modal', 'The return flow confirms intent and captures reason.'),
      overview('5.3', 'tutorial-return-reason', 'Return reason', 'Pick a reason for the return if required.'),
      mandatory('5.4', 'tutorial-return-confirm-button', 'Confirm return', 'Confirm the sale return.'),
      mandatory('5.5', 'tutorial-returned-status', 'Returned status', 'The sale must show returned status before continuing.'),
    ],
  },
  {
    id: 'business-partner',
    ...taskText('business-partner', '6. Create Business Partner', 'Create a partner locked to both customer and supplier roles.'),
    route: '/business-partners',
    markers: [
      mandatory('6.1', 'tutorial-business-partner-add', 'Add Business Partner', 'Open the create partner modal.'),
      mandatory('6.3', 'tutorial-business-partner-name', 'Partner name', 'Enter the partner or company name.'),
      mandatory('6.4', 'tutorial-business-partner-phone', 'Phone', 'Enter the required phone/contact field.'),
      mandatory('6.5', 'tutorial-business-partner-address', 'Address', 'Enter the required address field.'),
      overview('6.6', 'tutorial-business-partner-currency', 'Currency and credit', 'Currency and credit fields define future transaction defaults.'),
      mandatory('6.7', 'tutorial-business-partner-save', 'Save partner', 'Save the partner to continue.'),
      mandatory('6.8', 'tutorial-business-partner-created', 'Created partner', 'The new partner appears in the list.'),
    ],
  },
  {
    id: 'order-choice',
    ...taskText('order-choice', '7. Choose Order Type', 'Choose whether to create a sales order or purchase order.'),
    route: '/orders',
    markers: [
      overview('7.1', 'tutorial-orders-landing', 'Orders module', 'Orders track sales and purchase workflows.'),
      mandatory('7.2', 'tutorial-order-choice-modal', 'Order choice', 'Choose which order flow to learn.'),
      overview('7.3', 'tutorial-order-choice-sales', 'New Sales Order', 'Creates an order for selling to a customer.'),
      overview('7.4', 'tutorial-order-choice-purchase', 'New Purchase Order', 'Creates an order for purchasing from a supplier.'),
      mandatory('7.5', 'tutorial-order-choice-redirect', 'Open form', 'The selected option opens the matching order form.'),
    ],
  },
  {
    id: 'order-form',
    ...taskText('order-form', '8. Create And Save Order', 'Fill the selected order form and save it.'),
    route: (state: DemoTutorialProgress) => (
      state.orderType === 'purchase' ? '/orders/new/purchase' : '/orders/new/sales'
    ),
    markers: [
      overview('8.1', 'tutorial-order-form-title', 'Order form', 'This form captures the order details.'),
      mandatory('8.2', 'tutorial-order-partner-picker', 'Partner picker', 'Select the business partner created earlier.'),
      mandatory('8.3', 'tutorial-order-storage', 'Storage dropdown', 'Choose the source or destination storage.'),
      mandatory('8.4', 'tutorial-order-product-picker', 'Link product', 'Select the product created earlier for this order line.'),
      mandatory('8.5', 'tutorial-order-quantity', 'Quantity', 'Enter the line quantity.'),
      mandatory('8.6', 'tutorial-order-unit-price', 'Unit price', 'Enter or confirm the unit price.'),
      overview('8.7', 'tutorial-order-date', 'Date', 'Use this date for expected delivery or order timing.'),
      overview('8.8', 'tutorial-order-currency', 'Currency', 'Currency controls totals and exchange handling.'),
      overview('8.9', 'tutorial-order-payment', 'Payment method', 'Choose the payment method for this order.'),
      overview('8.10', 'tutorial-order-paid', 'Paid toggle', 'Mark the order paid when settlement is already complete.'),
      overview('8.11', 'tutorial-order-commercials', 'Commercial fields', 'Discount, tax, and commercial fields affect the order total.'),
      overview('8.12', 'tutorial-order-notes', 'Notes and details', 'Use notes and details for fulfillment context.'),
      mandatory('8.14', 'tutorial-order-save', 'Save Order', 'Save the order to complete the advanced tutorial.'),
      mandatory('8.15', 'tutorial-order-created', 'Created order', 'The saved order opens for verification.'),
    ],
  },
  {
    id: 'complete',
    ...taskText('complete', '9. Completion', 'All advanced tutorial tasks are complete.'),
    markers: [
      mandatory('8.15', 'tutorial-order-created', 'Created order', 'The saved order opened for verification.'),
      overview('9.1', 'tutorial-completion-checklist', 'Completed checklist', 'Every advanced tutorial task is checked.'),
      mandatory('9.2', 'tutorial-finish-button', 'Finish tutorial', 'Close the tutorial overlay.'),
      overview('9.3', 'tutorial-finished-state', 'Completed state', 'This demo workspace remembers the tutorial is complete.'),
    ],
  },
]

const TASKS_BY_ID = new Map<DemoTutorialTaskId, DemoTutorialTaskDefinition>(
  DEMO_TUTORIAL_TASKS.map((task) => [task.id, task])
)

export const ADVANCED_TASK_ORDER: DemoTutorialTaskId[] = [
  'storage',
  'product',
  'pos-sale',
  'sales-history',
  'business-partner',
  'order-choice',
  'order-form',
  'complete',
]

export function getDemoTutorialTaskDefinition(taskId: DemoTutorialTaskId | null) {
  return taskId ? TASKS_BY_ID.get(taskId) ?? null : null
}

export function resolveDemoTutorialRoute(state: DemoTutorialProgress | null) {
  const definition = getDemoTutorialTaskDefinition(state?.currentTask ?? null)
  if (!definition || !state) return null
  return typeof definition.route === 'function' ? definition.route(state) : definition.route ?? null
}
