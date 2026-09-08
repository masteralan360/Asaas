import { getAppSettingSync, setAppSetting } from '@/local-db/settings'

export interface RestaurantTableActionVisibility {
    hideItemDelete: boolean
    hideCloseTicket: boolean
    hideClearAll: boolean
}

export const DEFAULT_RESTAURANT_TABLE_ACTION_VISIBILITY: RestaurantTableActionVisibility = {
    hideItemDelete: false,
    hideCloseTicket: false,
    hideClearAll: false,
}

function actionVisibilityKey(workspaceId: string) {
    return `restaurant_table_action_visibility:${workspaceId}`
}

function normalizeActionVisibility(value: unknown): RestaurantTableActionVisibility {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_RESTAURANT_TABLE_ACTION_VISIBILITY }
    }

    const settings = value as Partial<RestaurantTableActionVisibility>
    return {
        hideItemDelete: settings.hideItemDelete === true,
        hideCloseTicket: settings.hideCloseTicket === true,
        hideClearAll: settings.hideClearAll === true,
    }
}

export function readRestaurantTableActionVisibility(workspaceId?: string | null): RestaurantTableActionVisibility {
    if (!workspaceId) return { ...DEFAULT_RESTAURANT_TABLE_ACTION_VISIBILITY }

    const raw = getAppSettingSync(actionVisibilityKey(workspaceId))
    if (!raw) return { ...DEFAULT_RESTAURANT_TABLE_ACTION_VISIBILITY }

    try {
        return normalizeActionVisibility(JSON.parse(raw))
    } catch {
        return { ...DEFAULT_RESTAURANT_TABLE_ACTION_VISIBILITY }
    }
}

export async function saveRestaurantTableActionVisibility(
    workspaceId: string,
    settings: RestaurantTableActionVisibility,
) {
    const normalized = normalizeActionVisibility(settings)
    await setAppSetting(actionVisibilityKey(workspaceId), JSON.stringify(normalized))
    return normalized
}

export function shouldHideRestaurantTableAction({
    restaurantMode,
    isAdmin,
    settings,
    action,
}: {
    restaurantMode: boolean
    isAdmin: boolean
    settings: RestaurantTableActionVisibility
    action: keyof RestaurantTableActionVisibility
}) {
    return restaurantMode && !isAdmin && settings[action]
}
