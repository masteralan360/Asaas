import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { CheckCircle2, MapPin, Navigation, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/ui/components'
import { cn } from '@/lib/utils'
import { ADVANCED_TASK_ORDER, resolveDemoTutorialRoute } from './demoTutorialDefinitions'
import type { DemoTutorialMarker, DemoTutorialTaskDefinition } from './demoTutorialTypes'
import { useDemoTutorial } from './DemoTutorialProvider'

type MarkerPosition = {
  marker: DemoTutorialMarker
  target: HTMLElement
  rect: DOMRect
  isMissingRequiredValue: boolean
}

type TooltipPlacement = 'right' | 'left' | 'bottom' | 'top'

type PositionedMarker = MarkerPosition & {
  tooltip: {
    left: number
    top: number
    placement: TooltipPlacement
    width: number
    height: number
    compact: boolean
  }
}

type RectBounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type TooltipCandidate = {
  left: number
  top: number
  placement: TooltipPlacement
  naturalFit: boolean
  width: number
  height: number
  compact: boolean
}

type TooltipSize = {
  width: number
  height: number
  compact: boolean
}

type PanelPosition = {
  left: number
  top: number
  width: number
  height: number
}

const TARGET_OUTLINE_PADDING = 4
const FULL_TOOLTIP_WIDTH = 260
const FULL_TOOLTIP_HEIGHT = 92
const COMPACT_TOOLTIP_WIDTH = 164
const COMPACT_TOOLTIP_HEIGHT = 48
const TOOLTIP_GAP = 14
const TOOLTIP_MARGIN = 14
const TOOLTIP_STACK_GAP = 8
const TOOLTIP_ARROW_SIZE = 10
const TOOLTIP_ARROW_EDGE_PADDING = 18
const PANEL_DEFAULT_WIDTH = 420
const PANEL_DEFAULT_HEIGHT = 168
const PANEL_MARGIN = 16
const SPOTLIGHT_PADDING = 10
const GUIDED_SAFE_VIEWPORT_MARGIN = 24
const GUIDED_RESCROLL_DELAY_MS = 90
const OVERLAY_SELECTOR = '[data-demo-tutorial-overlay]'
const TOOLTIP_SELECTOR = '[data-demo-tutorial-tooltip]'
const GUIDED_MASK_SELECTOR = '[data-demo-tutorial-mask]'
const GUIDED_NEXT_SELECTOR = '[data-demo-tutorial-next]'
const ACTIVE_DIALOG_SELECTOR = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
const FLOATING_LAYER_SELECTOR = [
  '[data-radix-popper-content-wrapper]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="option"]',
  '[cmdk-list]',
  '[data-command-list]',
].join(',')
const FIELD_TARGET_SELECTOR = 'input, textarea, select, [role="combobox"]'
const BUTTON_TARGET_SELECTOR = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]'
const FOCUSABLE_TARGET_SELECTOR = [
  'button:not([disabled]):not([aria-disabled="true"])',
  '[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[role="button"]:not([aria-disabled="true"])',
  '[role="combobox"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')
const REQUIRED_FIELD_TARGET_IDS = new Set([
  'tutorial-storage-name-input',
  'tutorial-product-name',
  'tutorial-product-sku',
  'tutorial-product-storage',
  'tutorial-product-price',
  'tutorial-product-cost-price',
  'tutorial-product-initial-stock',
  'tutorial-business-partner-name',
  'tutorial-business-partner-phone',
  'tutorial-business-partner-address',
  'tutorial-order-partner-picker',
  'tutorial-order-product-picker',
  'tutorial-order-storage',
  'tutorial-order-quantity',
  'tutorial-order-unit-price',
])
const REQUIRED_POSITIVE_NUMBER_TARGET_IDS = new Set([
  'tutorial-product-price',
  'tutorial-product-cost-price',
  'tutorial-product-initial-stock',
  'tutorial-order-quantity',
  'tutorial-order-unit-price',
])
const REQUIRED_PICKER_TARGET_IDS = new Set([
  'tutorial-product-storage',
  'tutorial-order-storage',
])
const BUTTON_TARGET_IDS = new Set([
  'tutorial-storage-new-button',
  'tutorial-storage-save-button',
  'tutorial-product-save',
  'tutorial-pos-product-card',
  'tutorial-pos-payment-area',
  'tutorial-pos-payment-cash',
  'tutorial-pos-payment-digital',
  'tutorial-pos-payment-loan',
  'tutorial-pos-checkout',
  'tutorial-pos-print-receipt',
  'tutorial-pos-success-continue',
  'tutorial-return-sale-action',
  'tutorial-return-confirm-button',
  'tutorial-business-partner-add',
  'tutorial-business-partner-save',
  'tutorial-order-choice-sales',
  'tutorial-order-choice-purchase',
  'tutorial-order-choice-redirect',
  'tutorial-order-save',
  'tutorial-finish-button',
  'tutorial-finished-state',
])
const GUIDED_ACTION_TARGET_IDS = new Set([
  'tutorial-storage-new-button',
  'tutorial-storage-save-button',
  'tutorial-product-save',
  'tutorial-pos-product-card',
  'tutorial-pos-payment-area',
  'tutorial-pos-checkout',
  'tutorial-pos-success-continue',
  'tutorial-return-sale-action',
  'tutorial-return-confirm-button',
  'tutorial-business-partner-add',
  'tutorial-business-partner-save',
  'tutorial-order-choice-modal',
  'tutorial-order-choice-sales',
  'tutorial-order-choice-purchase',
  'tutorial-order-choice-redirect',
  'tutorial-order-save',
  'tutorial-finish-button',
])
const GUIDED_ACTION_CHILD_SELECTORS = new Map([
  [
    'tutorial-pos-payment-area',
    '[data-tour-id="tutorial-pos-payment-cash"], [data-tour-id="tutorial-pos-payment-digital"]',
  ],
  [
    'tutorial-order-choice-modal',
    '[data-tour-id="tutorial-order-choice-sales"], [data-tour-id="tutorial-order-choice-purchase"]',
  ],
])

function translateText(
  t: ReturnType<typeof useTranslation>['t'],
  key: string | undefined,
  defaultValue: string
) {
  return key ? t(key, { defaultValue }) : defaultValue
}

function getTaskTitle(t: ReturnType<typeof useTranslation>['t'], task: DemoTutorialTaskDefinition) {
  return translateText(t, task.titleKey, task.title)
}

function getTaskDescription(t: ReturnType<typeof useTranslation>['t'], task: DemoTutorialTaskDefinition) {
  return translateText(t, task.descriptionKey, task.description)
}

function getMarkerLabel(t: ReturnType<typeof useTranslation>['t'], marker: DemoTutorialMarker) {
  return translateText(t, marker.labelKey, marker.label)
}

function getMarkerDescription(t: ReturnType<typeof useTranslation>['t'], marker: DemoTutorialMarker) {
  return translateText(t, marker.descriptionKey, marker.description)
}

function stripTaskNumber(title: string) {
  return title.replace(/^\d+\.\s*/, '')
}

function findTarget(targetId: string) {
  return document.querySelector<HTMLElement>(`[data-tour-id="${targetId}"]`)
}

function isElementOnScreen(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return (
    rect.width > 0
    && rect.height > 0
    && rect.bottom >= 0
    && rect.right >= 0
    && rect.top <= window.innerHeight
    && rect.left <= window.innerWidth
    && style.display !== 'none'
    && style.visibility !== 'hidden'
  )
}

function getActiveDialogScope() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(ACTIVE_DIALOG_SELECTOR))
    .filter((dialog) => !dialog.closest(OVERLAY_SELECTOR) && isElementOnScreen(dialog))

  return dialogs.at(-1) ?? null
}

function getRectBounds(rect: DOMRect | RectBounds): RectBounds {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  }
}

function inflateRect(rect: DOMRect | RectBounds, amount: number): RectBounds {
  const bounds = getRectBounds(rect)
  return {
    left: bounds.left - amount,
    top: bounds.top - amount,
    right: bounds.right + amount,
    bottom: bounds.bottom + amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  }
}

function clampBoundsToViewport(bounds: RectBounds): RectBounds {
  const left = clamp(bounds.left, 0, window.innerWidth)
  const top = clamp(bounds.top, 0, window.innerHeight)
  const right = clamp(bounds.right, left, window.innerWidth)
  const bottom = clamp(bounds.bottom, top, window.innerHeight)

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

function getVisualViewportBounds(): RectBounds {
  const viewport = window.visualViewport
  const left = viewport?.offsetLeft ?? 0
  const top = viewport?.offsetTop ?? 0
  const width = viewport?.width ?? window.innerWidth
  const height = viewport?.height ?? window.innerHeight
  const right = left + width
  const bottom = top + height

  return { left, top, right, bottom, width, height }
}

function getSafeViewportBounds(): RectBounds {
  const viewport = getVisualViewportBounds()
  const margin = Math.min(GUIDED_SAFE_VIEWPORT_MARGIN, Math.max(8, viewport.height / 10))
  const left = viewport.left + margin
  const top = viewport.top + margin
  const right = viewport.right - margin
  const bottom = viewport.bottom - margin

  return {
    left,
    top,
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  }
}

function getUnionBounds(bounds: RectBounds[]): RectBounds | null {
  if (bounds.length === 0) return null

  const left = Math.min(...bounds.map((bound) => bound.left))
  const top = Math.min(...bounds.map((bound) => bound.top))
  const right = Math.max(...bounds.map((bound) => bound.right))
  const bottom = Math.max(...bounds.map((bound) => bound.bottom))

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

function isInteractiveElement(element: HTMLElement) {
  return element.matches(FOCUSABLE_TARGET_SELECTOR)
    || element.matches('[role="option"], [role="menuitem"]')
    || element.querySelector(FOCUSABLE_TARGET_SELECTOR) !== null
}

function getTargetOverflowBounds(target: HTMLElement) {
  const targetBounds = getRectBounds(target.getBoundingClientRect())
  const overflowBounds = Array.from(target.querySelectorAll<HTMLElement>('*')).flatMap((element) => {
    if (!isElementOnScreen(element) || !isInteractiveElement(element)) return []

    const rect = element.getBoundingClientRect()
    const extendsOutsideTarget = rect.left < targetBounds.left - 1
      || rect.top < targetBounds.top - 1
      || rect.right > targetBounds.right + 1
      || rect.bottom > targetBounds.bottom + 1

    return extendsOutsideTarget ? [inflateRect(rect, SPOTLIGHT_PADDING)] : []
  })

  return getUnionBounds(overflowBounds)
}

function getActiveFloatingLayerBounds() {
  const floatingBounds = Array.from(document.querySelectorAll<HTMLElement>(FLOATING_LAYER_SELECTOR)).flatMap((element) => {
    if (element.closest(OVERLAY_SELECTOR) || !isElementOnScreen(element)) return []
    return [inflateRect(element.getBoundingClientRect(), SPOTLIGHT_PADDING)]
  })

  return getUnionBounds(floatingBounds)
}

function getGuidedSpotlightBounds(position: MarkerPosition) {
  const bounds = getUnionBounds([
    inflateRect(position.rect, SPOTLIGHT_PADDING),
    getTargetOverflowBounds(position.target),
    getActiveFloatingLayerBounds(),
  ].filter((bound): bound is RectBounds => Boolean(bound)))

  return bounds ? clampBoundsToViewport(bounds) : null
}

function getSpotlightMaskStyles(bounds: RectBounds): CSSProperties[] {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  return [
    {
      left: 0,
      top: 0,
      width: viewportWidth,
      height: bounds.top,
    },
    {
      left: 0,
      top: bounds.top,
      width: bounds.left,
      height: bounds.height,
    },
    {
      left: bounds.right,
      top: bounds.top,
      width: Math.max(0, viewportWidth - bounds.right),
      height: bounds.height,
    },
    {
      left: 0,
      top: bounds.bottom,
      width: viewportWidth,
      height: Math.max(0, viewportHeight - bounds.bottom),
    },
  ]
}

function isInGuidedAllowedArea(element: Element, guidedTarget: HTMLElement) {
  return guidedTarget.contains(element)
    || Boolean(element.closest(OVERLAY_SELECTOR))
    || Boolean(element.closest(FLOATING_LAYER_SELECTOR))
}

function getTargetHighlightShadow(marker: DemoTutorialMarker) {
  if (marker.kind === 'mandatory') {
    return '0 0 0 2px rgb(20 184 166 / 0.8), 0 0 0 7px rgb(20 184 166 / 0.12)'
  }

  return '0 0 0 2px rgb(71 85 105 / 0.55), 0 0 0 7px rgb(71 85 105 / 0.10)'
}

function getTooltipSize(marker: DemoTutorialMarker, forceFullSize = false): TooltipSize {
  if (marker.kind === 'overview' && !forceFullSize) {
    return {
      width: COMPACT_TOOLTIP_WIDTH,
      height: COMPACT_TOOLTIP_HEIGHT,
      compact: true,
    }
  }

  return {
    width: FULL_TOOLTIP_WIDTH,
    height: FULL_TOOLTIP_HEIGHT,
    compact: false,
  }
}

function getTooltipBounds(tooltip: Pick<TooltipCandidate, 'left' | 'top' | 'width' | 'height'>): RectBounds {
  return {
    left: tooltip.left,
    top: tooltip.top,
    right: tooltip.left + tooltip.width,
    bottom: tooltip.top + tooltip.height,
    width: tooltip.width,
    height: tooltip.height,
  }
}

function getPanelBounds(panel: PanelPosition): RectBounds {
  return {
    left: panel.left,
    top: panel.top,
    right: panel.left + panel.width,
    bottom: panel.top + panel.height,
    width: panel.width,
    height: panel.height,
  }
}

function overlapArea(a: RectBounds, b: RectBounds) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
  return width * height
}

function getVisibleCheckPoints(rect: DOMRect) {
  const left = clamp(rect.left, 0, window.innerWidth - 1)
  const right = clamp(rect.right, 0, window.innerWidth - 1)
  const top = clamp(rect.top, 0, window.innerHeight - 1)
  const bottom = clamp(rect.bottom, 0, window.innerHeight - 1)
  const centerX = clamp(rect.left + rect.width / 2, 0, window.innerWidth - 1)
  const centerY = clamp(rect.top + rect.height / 2, 0, window.innerHeight - 1)

  return [
    [centerX, centerY],
    [clamp(left + 8, 0, window.innerWidth - 1), clamp(top + 8, 0, window.innerHeight - 1)],
    [clamp(right - 8, 0, window.innerWidth - 1), clamp(top + 8, 0, window.innerHeight - 1)],
    [clamp(left + 8, 0, window.innerWidth - 1), clamp(bottom - 8, 0, window.innerHeight - 1)],
    [clamp(right - 8, 0, window.innerWidth - 1), clamp(bottom - 8, 0, window.innerHeight - 1)],
  ] as const
}

function isTargetVisible(target: HTMLElement, rect: DOMRect) {
  if (!isTargetMeasurable(target, rect)) return false
  if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) {
    return false
  }

  const points = getVisibleCheckPoints(rect)
  return points.some(([x, y]) => {
    const topElement = document
      .elementsFromPoint(x, y)
      .find((element) => !element.closest(OVERLAY_SELECTOR))

    return topElement ? target === topElement || target.contains(topElement) : false
  })
}

function isTargetMeasurable(target: HTMLElement, rect: DOMRect) {
  const style = window.getComputedStyle(target)
  return (
    rect.width > 0
    && rect.height > 0
    && style.display !== 'none'
    && style.visibility !== 'hidden'
  )
}

function isFieldControl(element: Element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
}

function isFillableControl(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  if (control.disabled) return false

  if (control instanceof HTMLInputElement) {
    const ignoredTypes = new Set(['button', 'checkbox', 'file', 'hidden', 'radio', 'reset', 'submit'])
    return !control.readOnly && !ignoredTypes.has(control.type)
  }

  if (control instanceof HTMLTextAreaElement) {
    return !control.readOnly
  }

  return true
}

function getTargetControls(target: HTMLElement) {
  const controls: Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = []

  if (isFieldControl(target)) {
    controls.push(target)
  }

  controls.push(...Array.from(target.querySelectorAll('input, textarea, select')).filter(isFieldControl))

  return controls.filter(isFillableControl)
}

function parseNumericValue(value: string) {
  const normalized = value.replace(/,/g, '').replace(/[^\d.-]/g, '')
  if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return NaN
  return Number(normalized)
}

function isControlMissingValue(targetId: string, control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const value = String(control.value ?? '').trim()
  if (!value) return true

  if (!REQUIRED_POSITIVE_NUMBER_TARGET_IDS.has(targetId)) {
    return false
  }

  const numericValue = parseNumericValue(value)
  return !Number.isFinite(numericValue) || numericValue <= 0
}

function isPickerMissingValue(target: HTMLElement) {
  const picker = target.matches('[role="combobox"], button[aria-haspopup="listbox"]')
    ? target
    : target.querySelector<HTMLElement>('[role="combobox"], button[aria-haspopup="listbox"]')

  if (!picker) return true
  if (picker.hasAttribute('data-placeholder')) return true

  const text = picker.textContent?.replace(/\s+/g, ' ').trim() ?? ''
  return !text || /^(select|choose|search)\b/i.test(text)
}

function isOrderProductMissingValue(target: HTMLElement) {
  const linkedTarget = target.matches('[data-demo-product-linked]')
    ? target
    : target.querySelector<HTMLElement>('[data-demo-product-linked]')

  return linkedTarget?.getAttribute('data-demo-product-linked') !== 'true'
}

function isMissingRequiredFieldValue(marker: DemoTutorialMarker, target: HTMLElement) {
  if (marker.kind !== 'mandatory' || !REQUIRED_FIELD_TARGET_IDS.has(marker.targetId)) {
    return false
  }

  if (marker.targetId === 'tutorial-order-product-picker') {
    return isOrderProductMissingValue(target)
  }

  const controls = getTargetControls(target)
  if (controls.length > 0) {
    return controls.some((control) => isControlMissingValue(marker.targetId, control))
  }

  return REQUIRED_PICKER_TARGET_IDS.has(marker.targetId) && isPickerMissingValue(target)
}

function isFieldLikeTarget(target: HTMLElement) {
  return target.matches(FIELD_TARGET_SELECTOR) || target.querySelector(FIELD_TARGET_SELECTOR) !== null
}

function isButtonLikeTarget(marker: DemoTutorialMarker, target: HTMLElement) {
  return BUTTON_TARGET_IDS.has(marker.targetId) || target.matches(BUTTON_TARGET_SELECTOR)
}

function shouldRenderTargetHighlight(marker: DemoTutorialMarker, target: HTMLElement, isMissingRequiredValue: boolean) {
  return !isMissingRequiredValue && !isFieldLikeTarget(target) && !isButtonLikeTarget(marker, target)
}

function getFocusableTarget(target: HTMLElement) {
  if (target.matches(FOCUSABLE_TARGET_SELECTOR)) {
    return target
  }

  return target.querySelector<HTMLElement>(FOCUSABLE_TARGET_SELECTOR)
}

function getManualGuidedPosition(positions: MarkerPosition[], confirmedMarkerIds: ReadonlySet<string>) {
  return positions.find((position) => !confirmedMarkerIds.has(position.marker.id)) ?? null
}

function shouldShowGuidedNext(marker: DemoTutorialMarker) {
  return !GUIDED_ACTION_TARGET_IDS.has(marker.targetId)
}

function shouldConfirmGuidedTargetClick(marker: DemoTutorialMarker) {
  return GUIDED_ACTION_TARGET_IDS.has(marker.targetId)
}

function didClickGuidedActionTarget(marker: DemoTutorialMarker, eventTarget: Element, guidedTarget: HTMLElement) {
  const childSelector = GUIDED_ACTION_CHILD_SELECTORS.get(marker.targetId)
  if (childSelector) {
    return Boolean(eventTarget.closest(childSelector))
  }

  return guidedTarget.contains(eventTarget)
}

function isGuidedTargetInSafeView(target: HTMLElement, panel?: PanelPosition) {
  const rect = target.getBoundingClientRect()
  if (!isTargetMeasurable(target, rect)) return false

  const safeBounds = getSafeViewportBounds()
  const targetCenterX = rect.left + rect.width / 2
  const targetCenterY = rect.top + rect.height / 2
  const centerInSafeViewport = targetCenterX >= safeBounds.left
    && targetCenterX <= safeBounds.right
    && targetCenterY >= safeBounds.top
    && targetCenterY <= safeBounds.bottom

  const visibleWidth = Math.max(0, Math.min(rect.right, safeBounds.right) - Math.max(rect.left, safeBounds.left))
  const visibleHeight = Math.max(0, Math.min(rect.bottom, safeBounds.bottom) - Math.max(rect.top, safeBounds.top))
  const minimumVisibleWidth = Math.min(rect.width, 32)
  const minimumVisibleHeight = Math.min(rect.height, 32)
  const hasEnoughVisibleArea = visibleWidth >= minimumVisibleWidth && visibleHeight >= minimumVisibleHeight
  const overlapsPanel = panel
    ? overlapArea(inflateRect(rect, SPOTLIGHT_PADDING), getPanelBounds(panel)) > 0
    : false

  return centerInSafeViewport && hasEnoughVisibleArea && !overlapsPanel
}

function scrollGuidedTargetIntoView(target: HTMLElement, behavior: ScrollBehavior = 'smooth') {
  target.scrollIntoView({ behavior, block: 'center', inline: 'center' })
}

function focusGuidedTarget(target: HTMLElement) {
  scrollGuidedTargetIntoView(target)
  const focusTarget = getFocusableTarget(target) ?? target
  window.setTimeout(() => {
    focusTarget.focus({ preventScroll: true })
  }, 180)
}

function getMarkerPositions(markers: DemoTutorialMarker[], options: { requireVisible?: boolean } = {}) {
  const requireVisible = options.requireVisible ?? true
  const activeDialog = getActiveDialogScope()

  return markers.flatMap((marker) => {
    const target = findTarget(marker.targetId)
    if (!target) return []
    if (activeDialog && !activeDialog.contains(target)) return []
    const rect = target.getBoundingClientRect()
    if (!isTargetMeasurable(target, rect)) return []
    if (requireVisible && !isTargetVisible(target, rect)) return []
    return [{ marker, target, rect, isMissingRequiredValue: isMissingRequiredFieldValue(marker, target) }]
  })
}

function getTaskProgress(currentTask: string | null) {
  const index = currentTask ? ADVANCED_TASK_ORDER.indexOf(currentTask as any) : -1
  if (index < 0) return { completed: 0, total: 8, current: 0 }
  return {
    completed: Math.min(index, 8),
    total: 8,
    current: Math.min(index + 1, 8),
  }
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

function getTooltipCandidates(rect: DOMRect, size: TooltipSize): TooltipCandidate[] {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxLeft = viewportWidth - size.width - TOOLTIP_MARGIN
  const maxTop = viewportHeight - size.height - TOOLTIP_MARGIN

  return [
    {
      placement: 'right',
      left: clamp(rect.right + TOOLTIP_GAP, TOOLTIP_MARGIN, maxLeft),
      top: clamp(rect.top + (rect.height - size.height) / 2, TOOLTIP_MARGIN, maxTop),
      naturalFit: viewportWidth - rect.right - TOOLTIP_GAP - TOOLTIP_MARGIN >= size.width,
      ...size,
    },
    {
      placement: 'left',
      left: clamp(rect.left - size.width - TOOLTIP_GAP, TOOLTIP_MARGIN, maxLeft),
      top: clamp(rect.top + (rect.height - size.height) / 2, TOOLTIP_MARGIN, maxTop),
      naturalFit: rect.left - TOOLTIP_GAP - TOOLTIP_MARGIN >= size.width,
      ...size,
    },
    {
      placement: 'bottom',
      left: clamp(rect.left + (rect.width - size.width) / 2, TOOLTIP_MARGIN, maxLeft),
      top: clamp(rect.bottom + TOOLTIP_GAP, TOOLTIP_MARGIN, maxTop),
      naturalFit: viewportHeight - rect.bottom - TOOLTIP_GAP - TOOLTIP_MARGIN >= size.height,
      ...size,
    },
    {
      placement: 'top',
      left: clamp(rect.left + (rect.width - size.width) / 2, TOOLTIP_MARGIN, maxLeft),
      top: clamp(rect.top - size.height - TOOLTIP_GAP, TOOLTIP_MARGIN, maxTop),
      naturalFit: rect.top - TOOLTIP_GAP - TOOLTIP_MARGIN >= size.height,
      ...size,
    },
  ]
}

function getTooltipPosition(rect: DOMRect, blockers: RectBounds[], size: TooltipSize) {
  const placementPriority: Record<TooltipPlacement, number> = {
    right: 0,
    left: 1,
    bottom: 2,
    top: 3,
  }

  return getTooltipCandidates(rect, size)
    .map((candidate) => {
      const tooltipBounds = getTooltipBounds(candidate)
      const overlap = blockers.reduce((sum, blocker) => sum + overlapArea(tooltipBounds, blocker), 0)
      const score = (candidate.naturalFit ? 0 : 100000)
        + overlap * 10000
        + placementPriority[candidate.placement]

      return { candidate, score }
    })
    .sort((a, b) => a.score - b.score)[0].candidate
}

function getTooltipArrowStyle(rect: DOMRect, tooltip: PositionedMarker['tooltip']): CSSProperties {
  const targetCenterX = rect.left + rect.width / 2
  const targetCenterY = rect.top + rect.height / 2
  const minOffset = TOOLTIP_ARROW_EDGE_PADDING
  const maxHorizontalOffset = tooltip.width - TOOLTIP_ARROW_EDGE_PADDING - TOOLTIP_ARROW_SIZE
  const maxVerticalOffset = tooltip.height - TOOLTIP_ARROW_EDGE_PADDING - TOOLTIP_ARROW_SIZE

  if (tooltip.placement === 'bottom') {
    return {
      left: clamp(targetCenterX - tooltip.left - TOOLTIP_ARROW_SIZE / 2, minOffset, maxHorizontalOffset),
      top: -6,
    }
  }

  if (tooltip.placement === 'top') {
    return {
      left: clamp(targetCenterX - tooltip.left - TOOLTIP_ARROW_SIZE / 2, minOffset, maxHorizontalOffset),
      bottom: -6,
    }
  }

  if (tooltip.placement === 'right') {
    return {
      left: -6,
      top: clamp(targetCenterY - tooltip.top - TOOLTIP_ARROW_SIZE / 2, minOffset, maxVerticalOffset),
    }
  }

  return {
    right: -6,
    top: clamp(targetCenterY - tooltip.top - TOOLTIP_ARROW_SIZE / 2, minOffset, maxVerticalOffset),
  }
}

function getPositionedMarkers(positions: MarkerPosition[], extraBlockers: RectBounds[] = [], forceFullSize = false) {
  const placed: PositionedMarker[] = []
  const blockedTargets = [
    ...positions.map((position) => inflateRect(position.rect, TOOLTIP_STACK_GAP)),
    ...extraBlockers,
  ]

  for (const position of positions) {
    const blockedTooltips = placed.map((placedMarker) => (
      inflateRect(getTooltipBounds(placedMarker.tooltip), TOOLTIP_STACK_GAP)
    ))
    const tooltip = getTooltipPosition(
      position.rect,
      [...blockedTargets, ...blockedTooltips],
      getTooltipSize(position.marker, forceFullSize)
    )

    placed.push({
      ...position,
      tooltip,
    })
  }

  return placed
}

function getPanelPosition(
  positions: MarkerPosition[],
  positionedMarkers: PositionedMarker[],
  panelSize: { width: number; height: number }
): PanelPosition {
  const width = Math.min(panelSize.width || PANEL_DEFAULT_WIDTH, window.innerWidth - PANEL_MARGIN * 2)
  const height = Math.min(panelSize.height || PANEL_DEFAULT_HEIGHT, window.innerHeight - PANEL_MARGIN * 2)
  const right = window.innerWidth - width - PANEL_MARGIN
  const bottom = window.innerHeight - height - PANEL_MARGIN
  const verticalMiddle = (window.innerHeight - height) / 2

  const candidates: Array<PanelPosition & { priority: number }> = [
    { left: right, top: bottom, width, height, priority: 0 },
    { left: PANEL_MARGIN, top: bottom, width, height, priority: 1 },
    { left: right, top: PANEL_MARGIN, width, height, priority: 2 },
    { left: PANEL_MARGIN, top: PANEL_MARGIN, width, height, priority: 3 },
    { left: PANEL_MARGIN, top: clamp(verticalMiddle, PANEL_MARGIN, bottom), width, height, priority: 4 },
    { left: right, top: clamp(verticalMiddle, PANEL_MARGIN, bottom), width, height, priority: 5 },
  ]

  const blockers = [
    ...positions.map((position) => inflateRect(position.rect, TOOLTIP_STACK_GAP)),
    ...positionedMarkers.map((positionedMarker) => (
      inflateRect(getTooltipBounds(positionedMarker.tooltip), TOOLTIP_STACK_GAP)
    )),
  ]

  return candidates
    .map((candidate) => {
      const panelBounds = getPanelBounds(candidate)
      const overlap = blockers.reduce((sum, blocker) => sum + overlapArea(panelBounds, blocker), 0)
      return {
        candidate,
        score: overlap * 100 + candidate.priority,
      }
    })
    .sort((a, b) => a.score - b.score)[0].candidate
}

export function DemoTutorialOverlay() {
  const { t } = useTranslation()
  const [location] = useLocation()
  const {
    state,
    isActive,
    currentTask,
    currentTaskDefinition,
    goToCurrentTask,
    finishTutorial,
  } = useDemoTutorial()
  const [positions, setPositions] = useState<MarkerPosition[]>([])
  const [confirmedGuidedMarkerIds, setConfirmedGuidedMarkerIds] = useState<Set<string>>(() => new Set())
  const panelRef = useRef<HTMLDivElement>(null)
  const lastGuidedFocusRef = useRef<string | null>(null)
  const [panelSize, setPanelSize] = useState({
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_DEFAULT_HEIGHT,
  })

  const markers = useMemo(() => currentTaskDefinition?.markers ?? [], [currentTaskDefinition])
  const expectedRoute = resolveDemoTutorialRoute(state)
  const isOnExpectedRoute = !expectedRoute
    || location === expectedRoute
    || location.startsWith(`${expectedRoute}/`)
  const shouldAutoGuide = state?.mode === 'advanced' && state.advancedAutoGuide !== false
  const guidedPosition = useMemo(
    () => (shouldAutoGuide ? getManualGuidedPosition(positions, confirmedGuidedMarkerIds) : null),
    [confirmedGuidedMarkerIds, positions, shouldAutoGuide]
  )
  const activeGuidedPosition = shouldAutoGuide && isOnExpectedRoute ? guidedPosition : null
  const confirmGuidedMarker = useCallback((markerId: string) => {
    lastGuidedFocusRef.current = null
    setConfirmedGuidedMarkerIds((current) => {
      if (current.has(markerId)) return current
      const next = new Set(current)
      next.add(markerId)
      return next
    })
  }, [])
  const updatePositions = useCallback(() => {
    if (!isActive || markers.length === 0) {
      setPositions([])
      return
    }
    setPositions(getMarkerPositions(markers, { requireVisible: !shouldAutoGuide }))
  }, [isActive, markers, shouldAutoGuide])

  useEffect(() => {
    lastGuidedFocusRef.current = null
    setConfirmedGuidedMarkerIds(new Set())
  }, [currentTask])

  useEffect(() => {
    if (
      !shouldAutoGuide
      || currentTask !== 'pos-sale'
      || state?.mode !== 'advanced'
      || state.saleId
      || !confirmedGuidedMarkerIds.has('3.1')
      || activeGuidedPosition?.marker.id === '3.1'
    ) {
      return
    }

    const timeout = window.setTimeout(() => {
      const tutorialCartItem = document.querySelector('[data-tour-id="tutorial-pos-cart-quantity"]')
      if (tutorialCartItem) return

      lastGuidedFocusRef.current = null
      setConfirmedGuidedMarkerIds((current) => {
        const hasConfirmedPosMarkers = Array.from(current).some((markerId) => markerId.startsWith('3.'))
        if (!hasConfirmedPosMarkers) return current

        return new Set(Array.from(current).filter((markerId) => !markerId.startsWith('3.')))
      })
    }, 180)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [
    activeGuidedPosition?.marker.id,
    confirmedGuidedMarkerIds,
    currentTask,
    positions,
    shouldAutoGuide,
    state?.mode,
    state?.saleId,
  ])

  useEffect(() => {
    if (!isActive || markers.length === 0) return
    const nextPositions = getMarkerPositions(markers, { requireVisible: !shouldAutoGuide })
    const firstPosition = shouldAutoGuide
      ? getManualGuidedPosition(nextPositions, confirmedGuidedMarkerIds)
      : nextPositions[0]
    if (firstPosition) {
      scrollGuidedTargetIntoView(firstPosition.target)
    }
  }, [confirmedGuidedMarkerIds, currentTask, isActive, markers, shouldAutoGuide])

  useEffect(() => {
    updatePositions()
    const timeout = window.setTimeout(updatePositions, 250)
    const observer = new MutationObserver((records) => {
      const onlyOverlayChanged = records.every((record) => (
        record.target instanceof Element && !!record.target.closest(OVERLAY_SELECTOR)
      ))
      if (onlyOverlayChanged) return

      window.requestAnimationFrame(updatePositions)
    })

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['aria-hidden', 'class', 'data-state', 'data-tour-id', 'style'],
      childList: true,
      subtree: true,
    })

    window.addEventListener('resize', updatePositions)
    window.addEventListener('scroll', updatePositions, true)
    window.addEventListener('input', updatePositions, true)
    window.addEventListener('change', updatePositions, true)
    window.addEventListener('focusout', updatePositions, true)

    return () => {
      window.clearTimeout(timeout)
      observer.disconnect()
      window.removeEventListener('resize', updatePositions)
      window.removeEventListener('scroll', updatePositions, true)
      window.removeEventListener('input', updatePositions, true)
      window.removeEventListener('change', updatePositions, true)
      window.removeEventListener('focusout', updatePositions, true)
    }
  }, [updatePositions, location])

  useEffect(() => {
    if (!shouldAutoGuide || !guidedPosition || !isOnExpectedRoute) return

    const focusKey = `${currentTask ?? 'none'}:${guidedPosition.marker.id}:${guidedPosition.marker.targetId}`
    if (lastGuidedFocusRef.current === focusKey) return

    const timeout = window.setTimeout(() => {
      focusGuidedTarget(guidedPosition.target)
      lastGuidedFocusRef.current = focusKey
    }, 120)

    return () => {
      window.clearTimeout(timeout)
    }
  }, [currentTask, guidedPosition, isOnExpectedRoute, shouldAutoGuide])

  useEffect(() => {
    if (!activeGuidedPosition) return

    const guidedTarget = activeGuidedPosition.target
    const focusTarget = getFocusableTarget(guidedTarget) ?? guidedTarget
    const blockOutsideGuidedArea = (event: Event) => {
      const eventTarget = event.target
      if (!(eventTarget instanceof Element)) {
        return
      }

      if (eventTarget.closest(GUIDED_NEXT_SELECTOR)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        if (event.type === 'pointerup' || event.type === 'click') {
          confirmGuidedMarker(activeGuidedPosition.marker.id)
        }
        return
      }

      if (eventTarget.closest(TOOLTIP_SELECTOR)) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        focusTarget.focus({ preventScroll: true })
        return
      }

      if (!eventTarget.closest(GUIDED_MASK_SELECTOR) && isInGuidedAllowedArea(eventTarget, guidedTarget)) {
        if (
          event.type === 'click'
          && shouldConfirmGuidedTargetClick(activeGuidedPosition.marker)
          && didClickGuidedActionTarget(activeGuidedPosition.marker, eventTarget, guidedTarget)
        ) {
          confirmGuidedMarker(activeGuidedPosition.marker.id)
        }
        return
      }

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      focusTarget.focus({ preventScroll: true })
    }
    const redirectOutsideFocus = (event: FocusEvent) => {
      const eventTarget = event.target
      if (!(eventTarget instanceof Element) || isInGuidedAllowedArea(eventTarget, guidedTarget)) {
        return
      }

      event.stopPropagation()
      window.setTimeout(() => {
        focusTarget.focus({ preventScroll: true })
      }, 0)
    }

    document.addEventListener('pointerdown', blockOutsideGuidedArea, true)
    document.addEventListener('pointerup', blockOutsideGuidedArea, true)
    document.addEventListener('mousedown', blockOutsideGuidedArea, true)
    document.addEventListener('click', blockOutsideGuidedArea, true)
    document.addEventListener('focusin', redirectOutsideFocus, true)

    return () => {
      document.removeEventListener('pointerdown', blockOutsideGuidedArea, true)
      document.removeEventListener('pointerup', blockOutsideGuidedArea, true)
      document.removeEventListener('mousedown', blockOutsideGuidedArea, true)
      document.removeEventListener('click', blockOutsideGuidedArea, true)
      document.removeEventListener('focusin', redirectOutsideFocus, true)
    }
  }, [activeGuidedPosition, confirmGuidedMarker])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return

    const measure = () => {
      const next = {
        width: panel.offsetWidth || PANEL_DEFAULT_WIDTH,
        height: panel.offsetHeight || PANEL_DEFAULT_HEIGHT,
      }
      setPanelSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ))
    }

    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(panel)

    return () => {
      observer.disconnect()
    }
  }, [])

  const progress = useMemo(() => getTaskProgress(currentTask), [currentTask])
  const displayPositions = useMemo(
    () => {
      if (activeGuidedPosition) return [activeGuidedPosition]
      return shouldAutoGuide ? [] : positions
    },
    [activeGuidedPosition, positions, shouldAutoGuide]
  )
  const guidedSpotlightBounds = activeGuidedPosition ? getGuidedSpotlightBounds(activeGuidedPosition) : null
  const preliminaryPositionedMarkers = useMemo(
    () => getPositionedMarkers(displayPositions, [], Boolean(activeGuidedPosition)),
    [activeGuidedPosition, displayPositions]
  )
  const panelPosition = useMemo(
    () => getPanelPosition(displayPositions, preliminaryPositionedMarkers, panelSize),
    [displayPositions, panelSize, preliminaryPositionedMarkers]
  )
  const positionedMarkers = useMemo(
    () => getPositionedMarkers(
      displayPositions,
      [inflateRect(getPanelBounds(panelPosition), TOOLTIP_STACK_GAP)],
      Boolean(activeGuidedPosition)
    ),
    [activeGuidedPosition, displayPositions, panelPosition]
  )

  useEffect(() => {
    if (!activeGuidedPosition) return

    let frame = 0
    let timeout = 0
    const target = activeGuidedPosition.target
    const ensureTargetInView = (behavior: ScrollBehavior = 'smooth') => {
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(frame)
      timeout = window.setTimeout(() => {
        frame = window.requestAnimationFrame(() => {
          if (!isGuidedTargetInSafeView(target, panelPosition)) {
            scrollGuidedTargetIntoView(target, behavior)
          }
        })
      }, GUIDED_RESCROLL_DELAY_MS)
    }

    ensureTargetInView()
    const handleViewportMovement = () => ensureTargetInView()

    window.addEventListener('resize', handleViewportMovement)
    window.addEventListener('scroll', handleViewportMovement, true)
    window.visualViewport?.addEventListener('resize', handleViewportMovement)
    window.visualViewport?.addEventListener('scroll', handleViewportMovement)

    return () => {
      window.clearTimeout(timeout)
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', handleViewportMovement)
      window.removeEventListener('scroll', handleViewportMovement, true)
      window.visualViewport?.removeEventListener('resize', handleViewportMovement)
      window.visualViewport?.removeEventListener('scroll', handleViewportMovement)
    }
  }, [
    activeGuidedPosition?.marker.id,
    activeGuidedPosition?.target,
    panelPosition.height,
    panelPosition.left,
    panelPosition.top,
    panelPosition.width,
  ])

  if (!isActive || !state || !currentTaskDefinition) {
    return null
  }

  const taskTitle = getTaskTitle(t, currentTaskDefinition)
  const taskDescription = getTaskDescription(t, currentTaskDefinition)
  const panelTitle = state.mode === 'advanced'
    ? t('demo.tutorial.panel.advancedTitle', {
      defaultValue: '{{current}}/{{total}} {{title}}',
      current: progress.current,
      total: progress.total,
      title: stripTaskNumber(taskTitle),
    })
    : taskTitle

  return (
    <div data-demo-tutorial-overlay className="pointer-events-none fixed inset-0 z-[2147483000] print:hidden">
      {guidedSpotlightBounds && (
        <>
          {getSpotlightMaskStyles(guidedSpotlightBounds).map((style, index) => (
            <div
              key={`guided-mask-${index}`}
              aria-hidden="true"
              data-demo-tutorial-mask
              className="pointer-events-auto fixed z-0 bg-slate-950/45"
              style={style}
            />
          ))}
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-10 rounded-xl shadow-[0_0_42px_rgba(20,184,166,0.28)]"
            style={{
              top: guidedSpotlightBounds.top,
              left: guidedSpotlightBounds.left,
              width: guidedSpotlightBounds.width,
              height: guidedSpotlightBounds.height,
            }}
          />
        </>
      )}
      {positionedMarkers.map(({ marker, target, rect, tooltip, isMissingRequiredValue }) => {
        const shouldShowTargetHighlight = shouldRenderTargetHighlight(marker, target, isMissingRequiredValue)
        const isActiveGuidedMarker = activeGuidedPosition?.marker.id === marker.id
        const showGuidedNext = Boolean(isActiveGuidedMarker && shouldShowGuidedNext(marker))
        const markerLabel = getMarkerLabel(t, marker)
        const markerDescription = getMarkerDescription(t, marker)
        const markerKindLabel = t(`demo.tutorial.kind.${marker.kind}`, { defaultValue: marker.kind })

        return (
          <div key={marker.id}>
            {shouldShowTargetHighlight && (
              <div
                className="fixed rounded-xl bg-transparent"
                style={{
                  top: rect.top - TARGET_OUTLINE_PADDING,
                  left: rect.left - TARGET_OUTLINE_PADDING,
                  width: rect.width + TARGET_OUTLINE_PADDING * 2,
                  height: rect.height + TARGET_OUTLINE_PADDING * 2,
                  boxShadow: getTargetHighlightShadow(marker),
                }}
              />
            )}
            <div
              data-demo-tutorial-tooltip
              className={cn(
                'pointer-events-auto fixed z-20 w-[260px] rounded-xl border p-2.5 text-sm shadow-[0_18px_45px_rgba(15,23,42,0.18)] transition-shadow hover:z-[2147483001] hover:shadow-[0_24px_60px_rgba(15,23,42,0.28)]',
                isMissingRequiredValue
                  ? 'border-red-300/90 bg-red-50 text-red-950 dark:border-red-500/60 dark:bg-red-950 dark:text-red-50'
                  : 'border-border/80 bg-background',
                tooltip.compact && 'p-2'
              )}
              style={{ top: tooltip.top, left: tooltip.left, width: tooltip.width }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute h-2.5 w-2.5 rotate-45 border',
                  isMissingRequiredValue
                    ? 'border-red-300/90 bg-red-50 dark:border-red-500/60 dark:bg-red-950'
                    : 'border-border/80 bg-background',
                  tooltip.placement === 'right' && 'border-r-0 border-t-0',
                  tooltip.placement === 'left' && 'border-b-0 border-l-0',
                  tooltip.placement === 'bottom' && 'border-b-0 border-r-0',
                  tooltip.placement === 'top' && 'border-l-0 border-t-0'
                )}
                style={getTooltipArrowStyle(rect, tooltip)}
              />
              <div className={cn('flex items-start gap-2', tooltip.compact && 'items-center gap-1.5')}>
                <span className={cn(
                  'flex h-7 min-w-10 items-center justify-center rounded-full px-2 text-[11px] font-black leading-none text-white shadow-sm',
                  tooltip.compact && 'h-6 min-w-9 text-[10px]',
                  isMissingRequiredValue
                    ? 'bg-red-600'
                    : marker.kind === 'mandatory'
                    ? 'bg-teal-600'
                    : 'bg-slate-600'
                )}>
                  {marker.id}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <MapPin className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      tooltip.compact && 'h-3 w-3',
                      isMissingRequiredValue
                        ? 'text-red-600 dark:text-red-300'
                        : marker.kind === 'mandatory'
                        ? 'text-teal-600'
                        : 'text-muted-foreground'
                    )} />
                    <span className={cn('min-w-0 truncate font-bold leading-5', tooltip.compact && 'text-xs leading-4')}>
                      {markerLabel}
                    </span>
                  </div>
                  {!tooltip.compact && (
                    <p
                      className={cn(
                        'mt-1 overflow-hidden text-[11px] leading-snug',
                        isMissingRequiredValue
                          ? 'text-red-800/80 dark:text-red-100/80'
                          : 'text-muted-foreground'
                      )}
                      style={{
                        display: '-webkit-box',
                        WebkitBoxOrient: 'vertical',
                        WebkitLineClamp: 2,
                      }}
                    >
                      {markerDescription}
                    </p>
                  )}
                </div>
                {!tooltip.compact && (
                  <span className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase',
                    isMissingRequiredValue
                      ? 'bg-red-500/10 text-red-700 dark:bg-red-400/15 dark:text-red-200'
                      : marker.kind === 'mandatory'
                      ? 'bg-teal-500/10 text-teal-700 dark:text-teal-300'
                      : 'bg-muted text-muted-foreground'
                  )}>
                    {markerKindLabel}
                  </span>
                )}
              </div>
              {showGuidedNext && (
                <div className="mt-2 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    data-demo-tutorial-next
                    className="h-8 px-3 text-xs font-bold"
                    disabled={isMissingRequiredValue}
                  >
                    {t('demo.tutorial.actions.next', { defaultValue: 'Next' })}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div
        ref={panelRef}
        data-tour-id={currentTask === 'complete' ? 'tutorial-completion-checklist' : undefined}
        className="pointer-events-auto fixed z-30 rounded-2xl border border-border/70 bg-background/95 p-4 shadow-2xl backdrop-blur-xl"
        style={{
          left: panelPosition.left,
          top: panelPosition.top,
          width: panelPosition.width,
        }}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-teal-500/10 p-2 text-teal-600">
            <Navigation className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-black">{panelTitle}</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {taskDescription}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground"
                onClick={finishTutorial}
                title={t('demo.tutorial.actions.finish', { defaultValue: 'Finish tutorial' })}
                data-tour-id={currentTask === 'complete' ? 'tutorial-finish-button' : undefined}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {state.mode === 'advanced' && (
              <div className="mt-3">
                <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>{t('demo.tutorial.panel.advancedLabel', { defaultValue: 'Advanced Tutorial' })}</span>
                  <span>
                    {t('demo.tutorial.panel.progressComplete', {
                      defaultValue: '{{completed}}/{{total}} complete',
                      completed: progress.completed,
                      total: progress.total,
                    })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-teal-500 transition-all"
                    style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            <div className="mt-3 grid gap-2">
              {!isOnExpectedRoute && (
                <Button type="button" className="h-9 w-full" onClick={goToCurrentTask}>
                  {t('demo.tutorial.actions.goToCurrentTask', { defaultValue: 'Go to current task' })}
                </Button>
              )}
              {currentTask === 'complete' && (
                <Button
                  type="button"
                  className="h-9 w-full"
                  onClick={finishTutorial}
                  data-tour-id="tutorial-finished-state"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {t('demo.tutorial.actions.finish', { defaultValue: 'Finish tutorial' })}
                </Button>
              )}
              {state.mode === 'basic' && (
                <Button type="button" className="h-9 w-full" onClick={finishTutorial}>
                  {t('demo.tutorial.actions.finishBasic', { defaultValue: 'Finish basic tutorial' })}
                </Button>
              )}
            </div>

            {positions.length === 0 && isOnExpectedRoute && currentTask !== 'order-choice' && (
              <p className="mt-3 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
                {t('demo.tutorial.panel.waitingForTarget', {
                  defaultValue: 'Open the related form or modal to reveal the next numbered indicators.',
                })}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
