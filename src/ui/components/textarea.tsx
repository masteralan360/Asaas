import * as React from "react"
import { cn, convertArabicIndicToLatin } from "@/lib/utils"
import { useOptionalAuth } from "@/auth"

export interface TextareaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { }


export interface TextareaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { }

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps & { allowViewer?: boolean }>(
    ({ className, allowViewer = false, disabled, ...props }, ref) => {
        const user = useOptionalAuth()?.user
        const isViewer = user?.role === 'viewer'
        const effectiveDisabled = disabled || (isViewer && !allowViewer)

        const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
            event.target.value = convertArabicIndicToLatin(event.target.value)
            props.onChange?.(event)
        }

        return (
            <textarea
                className={cn(
                    "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
                    className
                )}
                ref={ref}
                disabled={effectiveDisabled}
                {...props}
                onChange={handleChange}
            />
        )
    }
)
Textarea.displayName = "Textarea"

export { Textarea }
