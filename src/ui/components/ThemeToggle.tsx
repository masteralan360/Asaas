import { Moon, Sun, Monitor } from 'lucide-react'
import { useTheme } from '@/ui/components/theme-provider'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/ui/components/select'
import { useTranslation } from 'react-i18next'

export function ThemeToggle() {
    const { theme, setTheme } = useTheme()
    const { t } = useTranslation()

    return (
        <Select value={theme} onValueChange={(v) => setTheme(v as any)}>
            <SelectTrigger className="w-[130px] rounded-xl">
                <div className="flex items-center gap-2">
                    {theme === 'light' && <Sun className="h-4 w-4" />}
                    {theme === 'dark' && <Moon className="h-4 w-4" />}
                    {theme === 'system' && <Monitor className="h-4 w-4" />}
                    <SelectValue placeholder="Theme" />
                </div>
            </SelectTrigger>
            <SelectContent className="rounded-xl">
                <SelectItem value="light" className="cursor-pointer">
                    <div className="flex items-center gap-2">
                        <Sun className="h-4 w-4" />
                        {t('settings.theme.light')}
                    </div>
                </SelectItem>
                <SelectItem value="dark" className="cursor-pointer">
                    <div className="flex items-center gap-2">
                        <Moon className="h-4 w-4" />
                        {t('settings.theme.dark')}
                    </div>
                </SelectItem>
                <SelectItem value="system" className="cursor-pointer">
                    <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4" />
                        {t('settings.theme.system')}
                    </div>
                </SelectItem>
            </SelectContent>
        </Select>
    )
}
