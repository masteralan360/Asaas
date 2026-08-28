import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { AppDialog, AppDialogContent } from "./dialog";

export type MultipleModalPanel = {
  id: string;
  label: string;
  content: ReactNode;
  /** Lets each panel retain the width and height its workflow actually needs. */
  className?: string;
};

type MultipleModalLayoutProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The first panel is primary; up to three linked panels may follow it. */
  panels: readonly MultipleModalPanel[];
  /** Called by Escape when a linked panel, rather than the full flow, should close. */
  onCloseLastPanel?: () => void;
  /** Receives focus after the last linked panel is closed. */
  lastPanelTriggerRef?: RefObject<HTMLElement | null>;
  /** Controls the outer composite-dialog width. */
  className?: string;
  gapClassName?: string;
  align?: "start" | "center" | "stretch";
  breakpoint?: "sm" | "md" | "lg" | "xl";
  /** Prevents escape and backdrop dismissal while a mutation is running. */
  closeDisabled?: boolean;
};

/**
 * One accessible dialog shell for a primary workflow and up to three linked
 * panels. The panels share a backdrop, but their dimensions are independent:
 * on narrow screens they stack, and at the selected breakpoint they sit beside
 * one another without being forced to equal widths or heights.
 */
export function MultipleModalLayout({
  open,
  onOpenChange,
  panels,
  onCloseLastPanel,
  lastPanelTriggerRef,
  className,
  gapClassName = "gap-3",
  align = "start",
  breakpoint = "lg",
  closeDisabled = false,
}: MultipleModalLayoutProps) {
  const reduceMotion = useReducedMotion();
  const lastPanelRef = useRef<HTMLElement>(null);
  const previousPanelCount = useRef(panels.length);
  const visiblePanels = panels.slice(0, 4);
  const panelCount = visiblePanels.length;

  useEffect(() => {
    const previousCount = previousPanelCount.current;
    previousPanelCount.current = panelCount;
    const frame = requestAnimationFrame(() => {
      if (panelCount > previousCount) {
        lastPanelRef.current?.focus();
      } else if (panelCount < previousCount) {
        if (panelCount > 1) lastPanelRef.current?.focus();
        else lastPanelTriggerRef?.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [lastPanelTriggerRef, panelCount]);

  const breakpointClass = {
    sm: "sm:flex-row",
    md: "md:flex-row",
    lg: "lg:flex-row",
    xl: "xl:flex-row",
  }[breakpoint];
  const alignmentClass = {
    start: "items-start",
    center: "items-center",
    stretch: "items-stretch",
  }[align];
  const linkedPanelJustificationClass = {
    sm: "sm:justify-center",
    md: "md:justify-center",
    lg: "lg:justify-center",
    xl: "xl:justify-center",
  }[breakpoint];
  const hasLinkedPanels = panelCount > 1;

  if (!hasLinkedPanels) {
    const primaryPanel = visiblePanels[0];
    return (
      <AppDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && closeDisabled) return;
          onOpenChange(nextOpen);
        }}
      >
        <AppDialogContent
          showCloseButton={false}
          className={cn("max-w-2xl", primaryPanel?.className, className)}
          onPointerDownOutside={(event) => {
            if (closeDisabled) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (closeDisabled) event.preventDefault();
          }}
        >
          {primaryPanel?.content}
        </AppDialogContent>
      </AppDialog>
    );
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && closeDisabled) return;
        onOpenChange(nextOpen);
      }}
    >
      <AppDialogContent
        showCloseButton={false}
        className={cn(
          "gap-0 border-0 bg-transparent p-0 shadow-none sm:max-w-none",
          "sm:w-[min(calc(100vw-2rem),90rem)]",
          className,
        )}
        onPointerDownOutside={(event) => {
          if (closeDisabled || hasLinkedPanels) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (closeDisabled) {
            event.preventDefault();
            return;
          }
          if (hasLinkedPanels && onCloseLastPanel) {
            event.preventDefault();
            onCloseLastPanel();
          }
        }}
      >
        <div data-dialog-scroll-area className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:p-3">
          <motion.div
            layout={!reduceMotion}
            transition={{ layout: { duration: 0.28, ease: "easeOut" } }}
            className={cn("mx-auto flex min-h-full w-full", alignmentClass, "flex-col", gapClassName, breakpointClass, linkedPanelJustificationClass)}
          >
            {visiblePanels.map((panel, index) => (
              <motion.section
                key={panel.id}
                ref={index === panelCount - 1 ? lastPanelRef : undefined}
                layout={!reduceMotion}
                initial={index === panelCount - 1 && hasLinkedPanels && !reduceMotion ? { opacity: 0, x: 20, y: 12, scale: 0.985 } : false}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                transition={{
                  layout: { duration: 0.28, ease: "easeOut" },
                  opacity: { duration: 0.2, ease: "easeOut" },
                  x: { type: "spring", stiffness: 320, damping: 28 },
                  y: { type: "spring", stiffness: 320, damping: 28 },
                  scale: { type: "spring", stiffness: 320, damping: 28 },
                }}
                tabIndex={index === panelCount - 1 && hasLinkedPanels ? -1 : undefined}
                aria-label={panel.label}
                className={cn(
                  "flex min-w-0 flex-col overflow-hidden rounded-[1.25rem] border border-border/70 bg-background shadow-sm will-change-transform sm:rounded-[1.5rem]",
                  index === panelCount - 1 && hasLinkedPanels && "border-primary/25 shadow-lg outline-none",
                  panel.className,
                )}
              >
                {panel.content}
              </motion.section>
            ))}
          </motion.div>
        </div>
      </AppDialogContent>
    </AppDialog>
  );
}
