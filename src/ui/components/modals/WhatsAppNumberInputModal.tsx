import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    Input,
    Button,
    Label
} from '@/ui/components'
import { useTranslation } from 'react-i18next'
import { MessageCircle } from 'lucide-react'

interface WhatsAppNumberInputModalProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: (phone: string) => void
}

export function WhatsAppNumberInputModal({ isOpen, onClose, onConfirm }: WhatsAppNumberInputModalProps) {
    const { t } = useTranslation()
    const [phone, setPhone] = useState('')

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (phone.trim()) {
            onConfirm(phone.trim())
            setPhone('')
            onClose()
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MessageCircle className="w-5 h-5 text-emerald-600" />
                        {t('sales.share.whatsappTitle') || 'Share to WhatsApp'}
                    </DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="whatsapp-phone">
                            {t('sales.share.enterPhone') || 'Enter Customer Phone Number'}
                        </Label>
                        <Input
                            id="whatsapp-phone"
                            placeholder="e.g. 0770 123 4567"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            autoFocus
                            className="text-lg tracking-wider"
                        />
                        <p className="text-xs text-muted-foreground">
                            {t('sales.share.phoneHint') || 'Enter the number to open the chat directly.'}
                        </p>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            {t('common.cancel')}
                        </Button>
                        <Button
                            type="submit"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
                            disabled={!phone.trim()}
                        >
                            {t('common.share') || 'Share'}
                            <MessageCircle className="w-4 h-4" />
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
