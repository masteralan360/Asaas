import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/ui/components'
import { Sparkles, Rocket, Zap, Bug, ArrowRight, X, Globe, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PatchHighlight } from '@/hooks/usePatchNotes'
import { cn } from '@/lib/utils'

interface PatchNoteModalProps {
    isOpen: boolean
    onClose: () => void
    version: string
    date: string
    highlights: Record<string, PatchHighlight[]>
    teamMessages: Record<string, string>
}

const highlightConfig = {
    new: {
        icon: Sparkles,
        color: 'text-blue-500',
        bgColor: 'bg-blue-50 dark:bg-blue-900/20',
        badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
        label: 'common.badge_new'
    },
    improved: {
        icon: Zap,
        color: 'text-emerald-500',
        bgColor: 'bg-emerald-50 dark:bg-emerald-900/20',
        badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
        label: 'common.badge_improved'
    },
    fixed: {
        icon: Bug,
        color: 'text-orange-500',
        bgColor: 'bg-orange-50 dark:bg-orange-900/20',
        badge: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
        label: 'common.badge_fixed'
    }
}

const languages = [
    { code: 'en', label: 'English' },
    { code: 'ar', label: 'العربية' },
    { code: 'ku', label: 'کوردی' }
]

export function PatchNoteModal({ isOpen, onClose, version, date, highlights, teamMessages }: PatchNoteModalProps) {
    const { t, i18n } = useTranslation()
    const [modalLang, setModalLang] = useState(i18n.language || 'en')

    // Find first available language if current app lang has no notes
    const activeLang = highlights[modalLang] ? modalLang : (Object.keys(highlights)[0] || 'en')
    const activeHighlights = highlights[activeLang] || []
    const activeTeamMsg = teamMessages[activeLang]
    const isRTL = activeLang === 'ar' || activeLang === 'ku'

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden border-none bg-background/95 backdrop-blur-2xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] flex flex-col max-h-[90vh] rounded-[2rem]">
                {/* Header Decoration */}
                <div className="flex-none bg-gradient-to-br from-teal-400 via-primary/95 to-primary relative overflow-hidden flex flex-col items-center justify-center p-10 text-white">
                    {/* Language Switcher */}
                    <div className="absolute top-4 left-4 z-10">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 px-2 text-white/90 hover:text-white hover:bg-white/10 rounded-full border border-white/10 backdrop-blur-sm bg-white/5 gap-1.5 font-medium text-[11px] transition-all">
                                    <Globe className="w-3.5 h-3.5" />
                                    {languages.find(l => l.code === modalLang)?.label}
                                    <ChevronDown className="w-3 h-3 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-32 bg-background/80 backdrop-blur-xl border-border/50 rounded-xl">
                                {languages.map((l) => (
                                    <DropdownMenuItem
                                        key={l.code}
                                        onClick={() => setModalLang(l.code)}
                                        className={cn("text-xs cursor-pointer", modalLang === l.code && "bg-primary/10 text-primary font-bold")}
                                    >
                                        {l.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 text-white/80 hover:text-white transition-all p-1.5 rounded-full hover:bg-white/10 z-10"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    <div className="mx-auto w-16 h-16 bg-white/10 backdrop-blur-xl rounded-[1.5rem] flex items-center justify-center mb-6 shadow-2xl ring-1 ring-white/20 animate-in zoom-in slide-in-from-top-4 duration-700">
                        <Rocket className="w-8 h-8 text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" />
                    </div>

                    <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4 drop-shadow-[0_2px_4px_rgba(0,0,0,0.1)] text-center">
                        {t('common.newUpdate')}
                    </h2>

                    <div className="inline-flex items-center gap-2.5 px-5 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-[11px] font-black tracking-wide shadow-inner">
                        <Sparkles className="w-4 h-4 text-yellow-300" />
                        <span dir="ltr">{version} • {date}</span>
                    </div>

                    {/* Softer Background glows */}
                    <div className="absolute top-[-30%] left-[-10%] w-[80%] h-[80%] bg-teal-300/20 rounded-full blur-[100px] animate-pulse" />
                    <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-primary-dark/20 rounded-full blur-[100px]" />
                </div>

                <div className={cn("flex-1 overflow-y-auto p-10 space-y-10 custom-scrollbar", isRTL && "text-right")} dir={isRTL ? "rtl" : "ltr"}>
                    <DialogHeader className="hidden">
                        <DialogTitle>{t('common.whatsNew')}</DialogTitle>
                        <DialogDescription>Latest changes and improvements</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-8">
                        <h3 className="text-[10px] font-black text-muted-foreground/60 uppercase tracking-[0.3em] px-1">
                            {t('common.highlights')}
                        </h3>

                        <div className="space-y-8 px-1">
                            {activeHighlights.map((h, idx) => {
                                const cfg = highlightConfig[h.type] || highlightConfig.new
                                const Icon = cfg.icon
                                return (
                                    <div
                                        key={idx}
                                        className="flex gap-5 items-start animate-in slide-in-from-bottom-8 duration-700 fill-mode-both"
                                        style={{ animationDelay: `${idx * 100}ms` }}
                                    >
                                        <div className={cn(
                                            "mt-1 p-3 rounded-2xl shrink-0 transition-all duration-500 hover:scale-110 hover:rotate-3 shadow-lg shadow-black/5 flex items-center justify-center",
                                            cfg.bgColor
                                        )}>
                                            <Icon className={cn("w-5 h-5", cfg.color)} />
                                        </div>
                                        <div className="flex-1 min-w-0 pt-0.5">
                                            <div className="flex items-center gap-2.5 mb-2.5 flex-wrap">
                                                <h4 className="font-extrabold text-foreground text-[15px] tracking-tight">
                                                    {h.title}
                                                </h4>
                                                <span className={cn("px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest shadow-sm", cfg.badge)}>
                                                    {t(cfg.label)}
                                                </span>
                                            </div>
                                            <p className="text-[14px] text-muted-foreground font-medium leading-[1.6] opacity-90">
                                                {h.content}
                                            </p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Team Message */}
                    {activeTeamMsg && (
                        <div className="relative p-7 rounded-[1.5rem] bg-muted/20 border border-border/30 group hover:bg-muted/40 transition-all duration-500">
                            <div className={cn(
                                "absolute -top-3 bg-background px-3 text-[10px] font-black text-primary uppercase tracking-[0.2em] shadow-sm py-0.5 rounded-full border border-border/50",
                                isRTL ? "right-6" : "left-6"
                            )}>
                                {t('common.fromTeam', 'From the Team')}
                            </div>
                            <p className="text-[14px] text-foreground italic leading-relaxed font-semibold opacity-90">
                                "{activeTeamMsg}"
                            </p>
                        </div>
                    )}
                </div>

                <DialogFooter className="flex-none p-10 pt-2">
                    <Button
                        onClick={onClose}
                        className="w-full bg-primary hover:bg-primary-dark text-white font-black h-14 rounded-2xl transition-all active:scale-[0.98] shadow-2xl shadow-primary/20 flex items-center justify-center gap-3 group text-base tracking-tight"
                    >
                        {t('common.getStarted')}
                        <ArrowRight className={cn("w-5 h-5 transition-transform duration-300 group-hover:translate-x-1.5", isRTL && "rotate-180 group-hover:-translate-x-1.5")} />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
