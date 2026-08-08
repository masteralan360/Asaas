import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
Button,
    Label,
    Switch,
} from '@/ui/components'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PosAdjustProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    productsPerRow: number
    onProductsPerRowChange: (value: number) => void
    showQuantityIndicator: boolean
    onShowQuantityIndicatorChange: (value: boolean) => void
    showCategories: boolean
    onShowCategoriesChange: (value: boolean) => void
}

export function PosAdjust({
    open,
    onOpenChange,
    productsPerRow,
    onProductsPerRowChange,
    showQuantityIndicator,
    onShowQuantityIndicatorChange,
    showCategories,
    onShowCategoriesChange,
}: PosAdjustProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md rounded-2xl border-none shadow-2xl">
                <DialogHeader className="p-2 bg-muted/30 rounded-xl">
                    <DialogTitle className="flex items-center gap-3 text-xl">
                        <div className="p-2 bg-primary/10 rounded-xl">
                            <Menu className="w-5 h-5 text-primary" />
                        </div>
                        {t('pos.posAdjust', 'Pos Adjust')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('pos.posAdjustDescription', 'Adjust POS layout and display settings.')}
                    </DialogDescription>
                </DialogHeader>

                <div className="p-6 flex flex-col items-start gap-2">
                    <Label className="font-semibold text-sm">
                        {t('pos.columnsPerRow', 'Products per row')}
                    </Label>
                    <Select
                        value={productsPerRow.toString()}
                        onValueChange={(val) => onProductsPerRowChange(parseInt(val, 10))}
                    >
                        <SelectTrigger className="h-12 w-full rounded-xl border-dashed border-primary/50 bg-primary/5 font-bold">
                            <div className="flex items-center gap-2">
                                <Menu className="w-4 h-4 text-primary" />
                                <SelectValue placeholder="Columns" />
                            </div>
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="2">2 {t('pos.columns', 'Columns')}</SelectItem>
                            <SelectItem value="3">3 {t('pos.columns', 'Columns')}</SelectItem>
                            <SelectItem value="4">4 {t('pos.columns', 'Columns')}</SelectItem>
                            <SelectItem value="5">5 {t('pos.columns', 'Columns')}</SelectItem>
                            <SelectItem value="6">6 {t('pos.columns', 'Columns')}</SelectItem>
                            <SelectItem value="7">7 {t('pos.columns', 'Columns')}</SelectItem>
                            <SelectItem value="8">8 {t('pos.columns', 'Columns')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                <div className="mx-6 my-2 flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="space-y-1">
                        <Label htmlFor="pos-show-quantity-indicator" className="font-semibold">
                            {t('pos.showQuantityIndicator', 'Show quantity indicator')}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            {t('pos.showQuantityIndicatorDescription', 'Show the stock quantity badge on top of each product.')}
                        </p>
                    </div>
                    <Switch
                        id="pos-show-quantity-indicator"
                        checked={showQuantityIndicator}
                        onCheckedChange={onShowQuantityIndicatorChange}
                    />
                </div>

                <div className="mx-6 my-2 flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 p-4">
                    <div className="space-y-1">
                        <Label htmlFor="pos-show-categories" className="font-semibold">
                            {t('pos.showCategories', 'Show categories')}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                            {t('pos.showCategoriesDescription', 'Show the category chips above the products grid.')}
                        </p>
                    </div>
                    <Switch
                        id="pos-show-categories"
                        checked={showCategories}
                        onCheckedChange={onShowCategoriesChange}
                    />
                </div>

                <div className="p-4 bg-muted/20 border-t flex justify-end">
                    <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
                        {t('common.close', 'Close')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}