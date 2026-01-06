import { useTranslation } from 'react-i18next'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/ui/components/select'

export function LanguageSwitcher() {
    const { i18n } = useTranslation()

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng)
        localStorage.setItem('i18nextLng', lng)

        // Update document direction
        const dir = lng === 'ar' || lng === 'ku' ? 'rtl' : 'ltr'
        document.dir = dir
        document.documentElement.lang = lng
    }

    const languages = [
        { code: 'en', label: 'English' },
        { code: 'ar', label: 'العربية' },
        { code: 'ku', label: 'کوردی' },
    ]

    return (
        <Select value={i18n.language} onValueChange={changeLanguage}>
            <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Language" />
            </SelectTrigger>
            <SelectContent>
                {languages.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                        {lang.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
