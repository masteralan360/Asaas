import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    Button
} from '@/ui/components'
import { Sparkles, Rocket, Zap, Bug, ArrowRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PatchHighlight } from '@/hooks/usePatchNotes'
import { cn } from '@/lib/utils'

interface PatchNoteModalProps {
    isOpen: boolean
    onClose: () => void
    version: string
    date: string
    highlights: PatchHighlight[]
}

const highlightConfig = {
    new: {
        icon: Sparkles,
        color: 'text-blue-500',
        bgColor: 'bg-blue-50 dark:bg-blue-900/30',
        badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
        label: 'common.badge_new'
    },
    improved: {
        icon: Zap,
        color: 'text-green-500',
        bgColor: 'bg-green-50 dark:bg-green-900/30',
        badge: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
        label: 'common.badge_improved'
    },
    fixed: {
        icon: Bug,
        color: 'text-orange-500',
        bgColor: 'bg-orange-50 dark:bg-orange-900/30',
        badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
        label: 'common.badge_fixed'
    }
}

export function PatchNoteModal({ isOpen, onClose, version, date, highlights }: PatchNoteModalProps) {
    const { t } = useTranslation()

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[450px] p-0 overflow-hidden border-none bg-background/95 backdrop-blur-xl shadow-2xl flex flex-col max-h-[90vh] rounded-2xl">
                {/* Header Decoration */}
                <div className="flex-none bg-gradient-to-br from-[#2DD4BF] via-primary to-primary-dark relative overflow-hidden flex flex-col items-center justify-center p-8 text-white">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    <div className="mx-auto w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mb-5 shadow-lg ring-1 ring-white/30 animate-in zoom-in duration-500">
                        <Rocket className="w-7 h-7 text-white" />
                    </div>

                    <h2 className="text-2xl md:text-3xl font-black tracking-tight mb-3 drop-shadow-sm text-center">
                        {t('common.newUpdate')}
                    </h2>

                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/20 backdrop-blur-sm border border-white/20 text-xs font-semibold shadow-sm">
                        <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                        <span dir="ltr">{version} • {date}</span>
                    </div>

                    {/* Background glows */}
                    <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-white/10 rounded-full blur-[80px]" />
                    <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-black/10 rounded-full blur-[80px]" />
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                    <DialogHeader className="hidden">
                        <DialogTitle>{t('common.whatsNew')}</DialogTitle>
                        <DialogDescription>Latest changes and improvements</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6">
                        <h3 className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] px-1">
                            {t('common.highlights')}
                        </h3>

                        <div className="space-y-6 px-1">
                            {highlights.map((h, idx) => {
                                const cfg = highlightConfig[h.type] || highlightConfig.new
                                const Icon = cfg.icon
                                return (
                                    <div
                                        key={idx}
                                        className="flex gap-4 items-start animate-in slide-in-from-bottom-4 duration-700 fill-mode-both"
                                        style={{ animationDelay: `${idx * 150}ms` }}
                                    >
                                        <div className={cn("mt-0.5 p-2.5 rounded-xl shrink-0 transition-transform hover:scale-110", cfg.bgColor)}>
                                            <Icon className={cn("w-5 h-5", cfg.color)} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                                <h4 className="font-bold text-foreground text-sm uppercase tracking-tight">
                                                    {h.title}
                                                </h4>
                                                <span className={cn("px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider", cfg.badge)}>
                                                    {t(cfg.label)}
                                                </span>
                                            </div>
                                            <p className="text-[13px] text-muted-foreground font-medium leading-relaxed">
                                                {h.content}
                                            </p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Team Message */}
                    <div className="relative p-5 rounded-2xl bg-muted/30 border border-border/50 group hover:bg-muted/50 transition-colors">
                        <div className="absolute -top-3 left-4 bg-background px-2 text-[10px] font-black text-primary uppercase tracking-[0.15em]">
                            From the Team
                        </div>
                        <p className="text-[13px] text-foreground italic leading-relaxed font-medium">
                            "We're really excited about this release! The team has been working hard on performance improvements based on your feedback. Thanks for being part of our journey."
                        </p>
                    </div>
                </div>

                <DialogFooter className="flex-none p-8 pt-2">
                    <Button
                        onClick={onClose}
                        className="w-full bg-primary hover:bg-primary-dark text-white font-bold h-12 rounded-xl transition-all active:scale-95 shadow-xl shadow-primary/20 flex items-center justify-center gap-2 group"
                    >
                        {t('common.getStarted')}
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
