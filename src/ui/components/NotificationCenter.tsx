import { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { Inbox, NovuProvider } from '@novu/react';
import { useNotifications } from '@novu/react/hooks';
import { useAuth } from '@/auth';
import { novuConfig, getNovuSubscriberId } from '@/auth/novu';
import { Bell } from 'lucide-react';
import { useTheme } from './theme-provider';
import { useTranslation } from 'react-i18next';
import { toast } from '@/ui/components/use-toast';
import { connectionManager } from '@/lib/connectionManager';
import { NotificationPopupController } from './popups/NotificationPopupController';

function playNotificationSound() {
    try {
        const ctx = new AudioContext();
        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(830, now);
        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
        osc1.connect(gain1).connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.15);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1050, now + 0.12);
        gain2.gain.setValueAtTime(0.001, now);
        gain2.gain.setValueAtTime(0.15, now + 0.12);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc2.connect(gain2).connect(ctx.destination);
        osc2.start(now + 0.12);
        osc2.stop(now + 0.3);

        setTimeout(() => ctx.close(), 500);
    } catch {
        // Audio not available
    }
}

interface InboxWithBadgeProps {
    appearance: any;
    tabs: any[];
    notifications: any[] | undefined;
}

function InboxWithBadge({ appearance, tabs, notifications }: InboxWithBadgeProps) {
    const { t } = useTranslation();

    const unreadCount = useMemo(() => {
        return notifications?.filter(n => !n.read).length ?? 0;
    }, [notifications]);

    const alertedIdsRef = useRef<Set<string>>(new Set());
    const initialLoadRef = useRef(true);

    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [lastNotification, setLastNotification] = useState<any>(null);

    const showNotificationToast = useCallback(() => {
        playNotificationSound();
        toast({
            title: t('notifications.newNotificationTitle'),
            description: t('notifications.newNotification'),
            duration: 4000,
        });
    }, [t]);

    useEffect(() => {
        if (!notifications?.length) return;

        if (initialLoadRef.current) {
            for (const n of notifications) {
                alertedIdsRef.current.add(n.id);
            }
            initialLoadRef.current = false;
            return;
        }

        let hasNew = false;
        for (const n of notifications) {
            if (!alertedIdsRef.current.has(n.id)) {
                alertedIdsRef.current.add(n.id);
                hasNew = true;
            }
        }

        if (hasNew) {
            showNotificationToast();
            setLastNotification(notifications[0]);
            setIsPopupOpen(true);
        }
    }, [notifications, showNotificationToast]);

    return (
        <>
            <Inbox
                appearance={appearance}
                tabs={tabs}
                renderBell={() => (
                    <button className="relative hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground cursor-pointer mr-1 p-1.5">
                        <Bell className="w-4 h-4 transition-transform active:scale-90" />
                        {unreadCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white border-2 border-background animate-pop-in shadow-lg">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                        )}
                    </button>
                )}
            />

            <NotificationPopupController
                isOpen={isPopupOpen}
                onClose={() => setIsPopupOpen(false)}
                notificationData={lastNotification}
            />
        </>
    );
}

interface NotificationCenterContentProps {
    appearance: any;
    tabs: any[];
}

function NotificationCenterContent({ appearance, tabs }: NotificationCenterContentProps) {
    const { notifications, isLoading: isNotificationsLoading } = useNotifications();

    if (isNotificationsLoading) {
        return (
            <button className="relative p-2 rounded-md text-muted-foreground animate-pulse">
                <Bell className="w-4 h-4" />
            </button>
        );
    }

    return (
        <InboxWithBadge
            appearance={appearance}
            tabs={tabs}
            notifications={notifications}
        />
    );
}

export function NotificationCenter() {
    const { user, isLoading } = useAuth();
    const { theme, style } = useTheme();
    const { t, i18n } = useTranslation();
    const subscriberId = getNovuSubscriberId(user?.id);

    const [reconnectKey, setReconnectKey] = useState(0);
    const reconnectDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const unsubscribe = connectionManager.subscribe((event) => {
            if (event === 'wake' || event === 'online') {
                if (reconnectDebounceRef.current) clearTimeout(reconnectDebounceRef.current);
                reconnectDebounceRef.current = setTimeout(() => {
                    console.log('[NotificationCenter] Reconnecting NovuProvider due to:', event);
                    setReconnectKey(k => k + 1);
                }, 2000);
            }
        });

        return () => {
            unsubscribe();
            if (reconnectDebounceRef.current) clearTimeout(reconnectDebounceRef.current);
        };
    }, []);

    const isDark = useMemo(() => {
        return theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    }, [theme]);

    const appearance = useMemo(() => ({
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
    }), [isDark, style]);

    const tabs = useMemo(() => ([
        { label: t('notifications.tabs.all'), filter: {} },
        { label: t('notifications.tabs.workspace'), filter: { tags: ['workspace'] } },
        { label: t('notifications.tabs.user'), filter: { tags: ['user'] } }
    ]), [t, i18n.language]);

    if (isLoading) {
        return (
            <button className="relative p-2 rounded-md text-muted-foreground animate-pulse">
                <Bell className="w-4 h-4" />
            </button>
        );
    }

    if (!novuConfig.applicationIdentifier) {
        return (
            <button
                className="relative hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground cursor-pointer mr-1 opacity-50"
                title="Novu App ID not configured"
            >
                <Bell className="w-4 h-4" />
            </button>
        );
    }

    if (!subscriberId) {
        return (
            <button
                className="relative hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground cursor-pointer mr-1 opacity-50"
                title="Waiting for user session..."
            >
                <Bell className="w-4 h-4" />
            </button>
        );
    }

    return (
        <NovuProvider
            key={reconnectKey}
            subscriberId={subscriberId}
            applicationIdentifier={novuConfig.applicationIdentifier}
            apiUrl={novuConfig.apiUrl}
            socketUrl={novuConfig.socketUrl}
        >
            <NotificationCenterContent appearance={appearance} tabs={tabs} />
        </NovuProvider>
    );
}
