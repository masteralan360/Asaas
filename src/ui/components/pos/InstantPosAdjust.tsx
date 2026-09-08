import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'

import {
    AppDialog,
    AppDialogBody,
    AppDialogContent,
    AppDialogDescription,
    AppDialogFooter,
    AppDialogHeader,
    AppDialogTitle,
    Button,
    Label,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/ui/components'

interface InstantPosAdjustProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    productsPerRow: number
    onProductsPerRowChange: (value: number) => void
}

export function InstantPosAdjust({
    open,
    onOpenChange,
    productsPerRow,
    onProductsPerRowChange,
}: InstantPosAdjustProps) {
    const { t } = useTranslation()

    return (
        <AppDialog open={open} onOpenChange={onOpenChange}>
            <AppDialogContent className="max-w-md">
                <AppDialogHeader>
                    <AppDialogTitle className="flex items-center gap-3 text-xl">
                        <span className="rounded-xl bg-primary/10 p-2 text-primary">
                            <Menu className="h-5 w-5" />
                        </span>
                        {t('instantPos.adjust')}
                    </AppDialogTitle>
                    <AppDialogDescription>
                        {t('instantPos.adjustDescription')}
                    </AppDialogDescription>
                </AppDialogHeader>

                <AppDialogBody>
                    <div className="flex flex-col items-start gap-2">
                        <Label className="text-sm font-semibold">
                            {t('pos.columnsPerRow')}
                        </Label>
                        <Select
                            value={String(productsPerRow)}
                            onValueChange={(value) => onProductsPerRowChange(Number.parseInt(value, 10))}
                        >
                            <SelectTrigger className="h-12 w-full rounded-xl border-dashed border-primary/50 bg-primary/5 font-bold">
                                <span className="flex items-center gap-2">
                                    <Menu className="h-4 w-4 text-primary" />
                                    <SelectValue placeholder={t('pos.columns')} />
                                </span>
                            </SelectTrigger>
                            <SelectContent>
                                {[2, 3, 4, 5, 6, 7, 8].map((columns) => (
                                    <SelectItem key={columns} value={String(columns)}>
                                        {columns} {t('pos.columns')}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </AppDialogBody>

                <AppDialogFooter>
                    <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
                        {t('common.close')}
                    </Button>
                </AppDialogFooter>
            </AppDialogContent>
        </AppDialog>
    )
}
