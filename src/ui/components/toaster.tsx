import type { CSSProperties } from "react"
import { CheckCircle2, CircleAlert, Info, TriangleAlert } from "lucide-react"
import {
    Toast,
    ToastClose,
    ToastDescription,
    ToastProvider,
    ToastTitle,
    ToastViewport,
} from "@/ui/components/toast"
import { useToast, type ToastRecord } from "@/ui/components/use-toast"

import { cn } from "@/lib/utils"
import { isDesktop } from '@/lib/platform'

const variantMeta = {
    default: {
        icon: Info,
        badge: "bg-primary/10 text-primary",
        accent: "bg-primary/80",
        progress: "bg-primary/60",
    },
    destructive: {
        icon: CircleAlert,
        badge: "bg-red-500/10 text-red-600 dark:text-red-400",
        accent: "bg-red-500",
        progress: "bg-red-500/70",
    },
    success: {
        icon: CheckCircle2,
        badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        accent: "bg-emerald-500",
        progress: "bg-emerald-500/70",
    },
    warning: {
        icon: TriangleAlert,
        badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        accent: "bg-amber-500",
        progress: "bg-amber-500/70",
    },
} as const

type ToastVariant = keyof typeof variantMeta

type ToastPopupPlacement = 'floating' | 'sticky-bar'

function ToastPopup({ toasts, placement }: { toasts: ToastRecord[]; placement: ToastPopupPlacement }) {
    const isStickyBar = placement === 'sticky-bar'

    return (
        <ToastProvider duration={5000} swipeDirection="right">
            {toasts.map(({ id, title, description, action, variant, duration, placement: _toastPlacement, motion: _toastMotion, ...props }, index) => {
                const meta = variantMeta[(variant ?? "default") as ToastVariant]
                const Icon = meta.icon
                const toastDuration = duration ?? 5000

                return (
                    <div
                        key={id}
                        className={cn(
                            "w-full max-w-[420px] transition-[transform,opacity] duration-300",
                            index > 0 && "scale-[0.97] opacity-75"
                        )}
                    >
                        <Toast {...props} duration={duration} variant={(variant ?? "default") as ToastVariant} motion={isStickyBar ? 'drop' : 'default'}>
                            <span
                                aria-hidden
                                className={cn(
                                    "pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-r-full",
                                    meta.accent
                                )}
                            />
                            <span
                                aria-hidden
                                className={cn(
                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                    meta.badge
                                )}
                            >
                                <Icon className="h-[18px] w-[18px]" />
                            </span>
                            <div className="grid flex-1 gap-0.5 py-0.5">
                                {title && <ToastTitle>{title}</ToastTitle>}
                                {description && <ToastDescription>{description}</ToastDescription>}
                            </div>
                            {action}
                            <ToastClose />
                            <span
                                aria-hidden
                                className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-2xl"
                            >
                                <span
                                    className={cn(
                                        "block h-full w-full origin-left animate-toast-progress group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused] rtl:origin-right",
                                        meta.progress
                                    )}
                                    style={{ "--toast-duration": `${toastDuration}ms` } as CSSProperties}
                                />
                            </span>
                        </Toast>
                    </div>
                )
            })}
            <ToastViewport
                className={cn(
                    isStickyBar && "bottom-auto right-auto left-[clamp(480px,31vw,50%)] top-[calc(var(--titlebar-height)+0.75rem)] w-[min(520px,calc(100vw-2rem))] max-h-[calc(100vh-var(--titlebar-height)-1rem)] -translate-x-1/2 flex-col items-center gap-2 p-0 rtl:left-auto rtl:right-[clamp(480px,31vw,50%)] rtl:translate-x-1/2"
                )}
            />
        </ToastProvider>
    )
}

export function Toaster() {
    const { toasts } = useToast()
    const isTauriDesktop = isDesktop()
    const stickyBarToasts = isTauriDesktop
        ? toasts.filter((toast) => toast.placement !== 'floating')
        : []
    const floatingToasts = isTauriDesktop
        ? toasts.filter((toast) => toast.placement === 'floating')
        : toasts

    return (
        <>
            {stickyBarToasts.length > 0 && <ToastPopup toasts={stickyBarToasts} placement="sticky-bar" />}
            {floatingToasts.length > 0 && <ToastPopup toasts={floatingToasts} placement="floating" />}
        </>
    )
}
