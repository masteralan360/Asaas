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
import { Sparkles, Rocket, Zap, Bug, ArrowRight, Globe, ChevronDown } from 'lucide-react'
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

const normalizeLanguage = (language?: string) => {
    const normalized = (language || 'en').split('-')[0]
    return languages.some((item) => item.code === normalized) ? normalized : 'en'
}

const hasPatchContent = (
    language: string,
    highlights: Record<string, PatchHighlight[]>,
    teamMessages: Record<string, string>
) => Boolean(highlights[language]?.length || teamMessages[language])

const getInitialLanguage = (
    preferredLanguage: string | undefined,
    highlights: Record<string, PatchHighlight[]>,
    teamMessages: Record<string, string>
) => {
    const normalized = normalizeLanguage(preferredLanguage)
    if (hasPatchContent(normalized, highlights, teamMessages)) return normalized

    const languageWithContent = languages.find((item) => hasPatchContent(item.code, highlights, teamMessages))
    if (languageWithContent) return languageWithContent.code

    if (highlights[normalized] || teamMessages[normalized] !== undefined) return normalized
    return languages.find((item) => highlights[item.code] || teamMessages[item.code] !== undefined)?.code || 'en'
}

export function PatchNoteModal({ isOpen, onClose, version, date, highlights, teamMessages }: PatchNoteModalProps) {
    const { i18n } = useTranslation()
    const [modalLang, setModalLang] = useState(() => getInitialLanguage(i18n.language, highlights, teamMessages))

    const activeLang = highlights[modalLang] || teamMessages[modalLang] !== undefined
        ? modalLang
        : getInitialLanguage(i18n.language, highlights, teamMessages)
    const modalT = i18n.getFixedT(activeLang)
    const activeHighlights = highlights[activeLang] || []
    const activeTeamMsg = teamMessages[activeLang]
    const isRTL = activeLang === 'ar' || activeLang === 'ku'
    const selectedLanguageLabel = languages.find((language) => language.code === modalLang)?.label || modalLang

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                dir={isRTL ? 'rtl' : 'ltr'}
                className="top-[calc(50%+var(--titlebar-height)/2+var(--safe-area-top)/2)] flex max-h-[calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-0.75rem)] w-[calc(100vw-0.75rem)] max-w-xl flex-col overflow-hidden rounded-[1.25rem] border-border/60 p-0 sm:w-full sm:max-h-[min(calc(100dvh-var(--titlebar-height)-var(--safe-area-top)-var(--safe-area-bottom)-2rem),760px)] sm:rounded-[1.75rem] [&>button:last-child]:border [&>button:last-child]:border-white/10 [&>button:last-child]:bg-white/10 [&>button:last-child]:text-white [&>button:last-child]:hover:bg-white/20 [&>button:last-child]:hover:text-white"
            >
                <div className="relative flex flex-none flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-teal-500 via-primary to-primary p-10 text-center">
                    <div className="pointer-events-none absolute inset-0 bg-black/20" />
                    <div className={cn("absolute top-4 z-10", isRTL ? "right-4" : "left-4")}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full border border-white/10 bg-white/5 px-2 text-[11px] font-medium text-white/90 backdrop-blur-sm transition-all hover:bg-white/10 hover:text-white">
                                    <Globe className="h-3.5 w-3.5" />
                                    <span>{selectedLanguageLabel}</span>
                                    <ChevronDown className="h-3 w-3 opacity-50" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align={isRTL ? 'end' : 'start'} className="w-32 bg-background/90 backdrop-blur-xl">
                                {languages.map((language) => (
                                    <DropdownMenuItem
                                        key={language.code}
                                        onClick={() => setModalLang(language.code)}
                                        className={cn("cursor-pointer text-xs", modalLang === language.code && "bg-primary/10 font-bold text-primary")}
                                    >
                                        {language.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <DialogHeader className="relative z-10 items-center space-y-0 text-center">
                        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-white/10 shadow-2xl ring-1 ring-white/20 backdrop-blur-xl">
                            <Rocket className="h-8 w-8 text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]" />
                        </div>

                        <DialogTitle className="mb-4 text-center text-3xl font-black tracking-tight text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)] md:text-4xl">
                            {modalT('common.newUpdate')}
                        </DialogTitle>

                        <DialogDescription className="inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-white/15 px-5 py-2 text-[11px] font-black tracking-wide text-white shadow-inner backdrop-blur-md">
                            <Sparkles className="h-4 w-4 text-yellow-300" />
                            <span dir="ltr">{version} / {date}</span>
                        </DialogDescription>
                    </DialogHeader>

                    <div className="absolute left-[-10%] top-[-30%] h-[80%] w-[80%] rounded-full bg-teal-300/20 blur-[100px]" />
                    <div className="absolute bottom-[-20%] right-[-10%] h-[60%] w-[60%] rounded-full bg-primary-dark/20 blur-[100px]" />
                </div>

                <div className={cn("flex-1 space-y-5 overflow-y-auto px-4 py-5 custom-scrollbar sm:px-6", isRTL && "text-right")}>
                    <section className="space-y-3">
                        <h3 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                            {modalT('common.highlights')}
                        </h3>

                        <div className="space-y-3">
                            {activeHighlights.length > 0 ? activeHighlights.map((highlight, index) => {
                                const cfg = highlightConfig[highlight.type] || highlightConfig.new
                                const Icon = cfg.icon
                                return (
                                    <div
                                        key={`${highlight.type}-${highlight.title}-${index}`}
                                        className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm"
                                    >
                                        <div className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", cfg.bgColor)}>
                                            <Icon className={cn("h-5 w-5", cfg.color)} />
                                        </div>
                                        <div className="min-w-0 flex-1 space-y-2">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <h4 className="text-sm font-extrabold leading-tight text-foreground">
                                                    {highlight.title}
                                                </h4>
                                                <span className={cn("rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wide", cfg.badge)}>
                                                    {modalT(cfg.label)}
                                                </span>
                                            </div>
                                            <p className="text-sm font-medium leading-6 text-muted-foreground">
                                                {highlight.content}
                                            </p>
                                        </div>
                                    </div>
                                )
                            }) : (
                                <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm font-medium text-muted-foreground">
                                    {modalT('common.noData')}
                                </div>
                            )}
                        </div>
                    </section>

                    {activeTeamMsg && (
                        <section className="rounded-2xl border border-border/60 bg-muted/25 p-4">
                            <h3 className="mb-2 text-xs font-black uppercase tracking-widest text-primary">
                                {modalT('common.fromTeam')}
                            </h3>
                            <p className="text-sm font-semibold leading-6 text-foreground">
                                {activeTeamMsg}
                            </p>
                        </section>
                    )}
                </div>

                <DialogFooter className="border-t bg-muted/20 px-4 py-4 pb-[calc(1rem+var(--safe-area-bottom))] sm:px-6">
                    <Button
                        onClick={onClose}
                        className="h-11 w-full gap-2 rounded-xl font-black sm:w-auto"
                    >
                        {modalT('common.getStarted')}
                        <ArrowRight className={cn("h-4 w-4 transition-transform", isRTL && "rotate-180")} />
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
