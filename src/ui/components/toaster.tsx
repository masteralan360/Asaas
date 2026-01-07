import {
    Toast,
    ToastClose,
    ToastDescription,
    ToastProvider,
    ToastTitle,
    ToastViewport,
} from "@/ui/components/toast"
import { useToast } from "@/ui/components/use-toast"

import { useTranslation } from "react-i18next"

export function Toaster() {
    const { toasts } = useToast()
    const { i18n } = useTranslation()

    const isEnglish = i18n.language === 'en'

    return (
        <ToastProvider>
            {toasts.map(function ({ id, title, description, action, ...props }) {
                return (
                    <Toast key={id} {...props}>
                        <div className="grid gap-1">
                            {title && <ToastTitle>{title}</ToastTitle>}
                            {description && (
                                <ToastDescription>{description}</ToastDescription>
                            )}
                        </div>
                        {action}
                        <ToastClose />
                    </Toast>
                )
            })}
            <ToastViewport className={isEnglish ? "sm:right-auto sm:left-0" : ""} />
        </ToastProvider>
    )
}
