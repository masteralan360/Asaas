import React from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    Button
} from '@/ui/components'
import { Sparkles, CheckCircle2, Rocket } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PatchNoteModalProps {
    isOpen: boolean
    onClose: () => void
    version: string
    date: string
    notes: string[]
}

export function PatchNoteModal({ isOpen, onClose, version, date, notes }: PatchNoteModalProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden border-none bg-background/95 backdrop-blur-xl shadow-2xl">
                {/* Header Decoration */}
                <div className="h-32 bg-gradient-to-br from-primary via-primary/80 to-primary/60 relative overflow-hidden flex items-center justify-center">
                    <div className="absolute inset-0 opacity-20">
                        <div className="absolute top-0 left-0 w-24 h-24 bg-white rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
                        <div className="absolute bottom-0 right-0 w-32 h-32 bg-white rounded-full blur-3xl translate-x-1/4 translate-y-1/4" />
                    </div>

                    <div className="relative z-10 flex flex-col items-center text-white">
                        <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-md mb-3 animate-bounce">
                            <Rocket className="w-8 h-8 text-white" />
                        </div>
                        <h2 className="text-2xl font-black tracking-tight">{t('common.newUpdate') || "New Update Available!"}</h2>
                        <div className="flex items-center gap-2 mt-1 px-3 py-1 bg-white/10 rounded-full text-xs font-bold backdrop-blur-sm border border-white/10">
                            <Sparkles className="w-3 h-3 text-yellow-300" />
                            {version} • {date}
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <DialogHeader className="hidden">
                        <DialogTitle>{t('common.whatsNew') || "What's New"}</DialogTitle>
                        <DialogDescription>Latest changes and improvements</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
                            {t('common.highlights') || "Highlights"}
                        </p>

                        <div className="space-y-3">
                            {notes.map((note, idx) => (
                                <div key={idx} className="flex gap-3 items-start animate-in slide-in-from-left-4 duration-500 fill-mode-both" style={{ animationDelay: `${idx * 100}ms` }}>
                                    <div className="mt-1 bg-primary/10 p-1 rounded-md text-primary shrink-0">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                    </div>
                                    <p className="text-sm text-foreground/90 font-medium leading-relaxed">
                                        {note}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-6 pt-0">
                    <Button
                        onClick={onClose}
                        className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold h-12 rounded-xl transition-all active:scale-95 shadow-lg shadow-primary/20"
                    >
                        {t('common.getStarted') || "Let's Go!"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
