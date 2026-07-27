import * as React from "react"

import { cn } from "@/lib/utils"
import {
    Dialog,
    DialogBody,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTitle,
    DialogTrigger
} from "./dialog"

/**
 * Dialog primitives for focused, compact interactions.
 *
 * This shares the accessible Radix integration used by `Dialog`, while its
 * content defaults to the narrower width used by small modals.
 */
const SmallDialog = Dialog

const SmallDialogTrigger = DialogTrigger

const SmallDialogPortal = DialogPortal

const SmallDialogOverlay = DialogOverlay

const SmallDialogClose = DialogClose

const SmallDialogContent = React.forwardRef<
    React.ElementRef<typeof DialogContent>,
    React.ComponentPropsWithoutRef<typeof DialogContent>
>(({ className, ...props }, ref) => (
    <DialogContent
        ref={ref}
        className={cn("sm:max-w-md", className)}
        {...props}
    />
))
SmallDialogContent.displayName = "SmallDialogContent"

const SmallDialogHeader = DialogHeader

const SmallDialogBody = DialogBody

const SmallDialogFooter = DialogFooter

const SmallDialogTitle = DialogTitle

const SmallDialogDescription = DialogDescription

export {
    SmallDialog,
    SmallDialogPortal,
    SmallDialogOverlay,
    SmallDialogTrigger,
    SmallDialogClose,
    SmallDialogContent,
    SmallDialogHeader,
    SmallDialogBody,
    SmallDialogFooter,
    SmallDialogTitle,
    SmallDialogDescription
}
