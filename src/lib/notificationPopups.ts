import { ExperimentalNovuModal } from '@/ui/components/novupopups/ExperimentalNovuModal';
import { Experimental2NovuModal } from '@/ui/components/novupopups/Experimental2NovuModal';

/**
 * Interface defining the rules for triggering a popup.
 * All specified rules must match (logical AND).
 */
export interface PopupRules {
    enabled: boolean;
    workflowSlug?: string;
    subjectMatch?: string;
    contentMatch?: string; // Maps to notification.body or notification.content
    preventOutsideClose?: boolean;
    showDebugInfo?: boolean;
}

/**
 * Interface for a formal popup definition in the registry.
 */
export interface PopupDefinition {
    id: string;
    component: React.ComponentType<any>;
    rules: PopupRules;
}

/**
 * CENTRAL REGISTRY OF POPUP DEFINITIONS
 * Order matters: The first match in the list wins (supports overrides).
 */
export const POPUP_REGISTRY: PopupDefinition[] = [
    {
        id: 'experimental-v2',
        component: Experimental2NovuModal,
        rules: {
            enabled: true,
            subjectMatch: "Phase10",
            contentMatch: "a2V5MTIz"
        }
    },
    {
        id: 'experimental-popup',
        component: ExperimentalNovuModal,
        rules: {
            enabled: false
        }
    }
];

/**
 * Internal helper to check if a notification matches a set of rules.
 */
function matchesRules(notification: any, rules: PopupRules): boolean {
    if (!rules.enabled) return false;

    const subject = notification.subject || "";
    const content = notification.body || notification.content || "";
    const workflowSlug = notification.workflow?.slug || notification.transactionId;

    // 1. Workflow Slug Match (Priority)
    if (rules.workflowSlug && workflowSlug !== rules.workflowSlug) {
        return false;
    }

    // 2. Exact Subject Match
    if (rules.subjectMatch && subject !== rules.subjectMatch) {
        return false;
    }

    // 3. Exact Content Match
    if (rules.contentMatch && content !== rules.contentMatch) {
        return false;
    }

    return true; // All specified rules passed
}

/**
 * Resolves which popup to show based on the registry rules.
 */
export function getPopupIdFromNotification(notification: any): string | null {
    if (!notification) return null;

    for (const definition of POPUP_REGISTRY) {
        if (matchesRules(notification, definition.rules)) {
            console.log(`[NotificationLib] MATCH FOUND: ${definition.id}`);
            return definition.id;
        }
    }

    return null;
}
