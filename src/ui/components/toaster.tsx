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
import { useToast } from "@/ui/components/use-toast"

import { cn } from "@/lib/utils"

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

export function Toaster() {
    const { toasts } = useToast()

    return (
        <ToastProvider duration={5000} swipeDirection="right">
            {toasts.map(({ id, title, description, action, variant, duration, ...props }, index) => {
                const meta = variantMeta[(variant ?? "default") as ToastVariant]
                const Icon = meta.icon
                const toastDuration = duration ?? 5000

                return (
                    <div
                        key={id}
                        className={cn(
                            "w-full max-w-[420px] origin-bottom transition-[transform,opacity] duration-300",
                            index > 0 && "scale-[0.97] opacity-75"
                        )}
                    >
                        <Toast {...props} variant={(variant ?? "default") as ToastVariant}>
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
            <ToastViewport />
        </ToastProvider>
    )
}