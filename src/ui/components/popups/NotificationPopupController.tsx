import { POPUP_REGISTRY, getPopupIdFromNotification } from '@/lib/notificationPopups';

interface NotificationPopupControllerProps {
    isOpen: boolean;
    onClose: () => void;
    notificationData?: any;
}

/**
 * Controller that dynamically renders the appropriate popup based on notification metadata.
 * It abstracts the popup selection logic away from the NotificationCenter.
 */
export function NotificationPopupController({
    isOpen,
    onClose,
    notificationData
}: NotificationPopupControllerProps) {
    if (!isOpen || !notificationData) return null;

    // Determine which popup to show
    const popupId = getPopupIdFromNotification(notificationData);

    if (!popupId) return null;

    // Look up the definition and component in the registry
    const definition = POPUP_REGISTRY.find(p => p.id === popupId);
    const PopupComponent = definition?.component;

    // If no component mapping exists, we don't show anything
    if (!PopupComponent) {
        console.warn(`[NotificationPopup] No component registered for popupId: ${popupId}`);
        return null;
    }

    // Render the dynamic component with the standard props and its specific config
    return (
        <PopupComponent
            isOpen={isOpen}
            onClose={onClose}
            notificationData={notificationData}
            config={definition?.rules}
        />
    );
}
