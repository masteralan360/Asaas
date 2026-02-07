import { Inbox, NovuProvider } from '@novu/react';
import { useAuth } from '@/auth';
import { novuConfig, getNovuSubscriberId } from '@/auth/novu';
import { Bell } from 'lucide-react';
import { useTheme } from './theme-provider';
import { useTranslation } from 'react-i18next';

export function NotificationCenter() {
    const { user } = useAuth();
    const { theme, style } = useTheme();
    const { t } = useTranslation();
    const subscriberId = getNovuSubscriberId(user?.id);

    const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    const appearance = {
        variables: {
            borderRadius: style === 'modern' ? '1rem' : '0.5rem',
            colorPrimary: '#3b82f6',
            colorBackground: isDark ? '#0f172a' : '#ffffff',
            colorForeground: isDark ? '#f8fafc' : '#0f172a',
            colorNeutral: isDark ? '#94a3b8' : '#64748b',
            fontSize: '14px',
        },
        elements: {
            popoverContent: `bg-popover border ${isDark ? 'border-white/10' : 'border-black/10'} shadow-2xl rounded-2xl overflow-hidden min-w-[420px]`,
            root: 'bg-transparent',
            notificationList: 'bg-popover p-0',
        }
    };

    if (!novuConfig.applicationIdentifier || !subscriberId) {
        return null;
    }

    return (
        <NovuProvider
            subscriberId={subscriberId}
            applicationIdentifier={novuConfig.applicationIdentifier}
        >
            <Inbox
                appearance={appearance}
                tabs={[
                    { label: t('notifications.tabs.all'), value: [] },
                    { label: t('notifications.tabs.workspace'), value: ['workspace'] },
                    { label: t('notifications.tabs.user'), value: ['user'] }
                ]}
                renderBell={(unreadCount) => {
                    const count = typeof unreadCount === 'number' ? unreadCount : 0;
                    return (
                        <button className="relative hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground cursor-pointer mr-1">
                            <Bell className="w-4 h-4 transition-transform active:scale-90" />
                            {count > 0 && (
                                <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white border-2 border-background animate-pop-in shadow-lg">
                                    {count > 9 ? '9+' : count}
                                </span>
                            )}
                        </button>
                    );
                }}
            />
        </NovuProvider>
    );
}
