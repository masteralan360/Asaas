import { useEffect, useRef, useState } from 'react'
import { MapPin, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/auth'
import { useWorkspace } from '@/workspace'
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    useToast
} from '@/ui/components'

function formatCoordination(latitude: number, longitude: number) {
    const lat = Number.isFinite(latitude) ? latitude.toFixed(14) : String(latitude)
    const lon = Number.isFinite(longitude) ? longitude.toFixed(14) : String(longitude)
    return `${lat}, ${lon}`
}

export function WorkspaceLocationPrompt() {
    const { user } = useAuth()
    const {
        branchInfo,
        features,
        isLoading,
        loadedWorkspaceId,
        resolvedBranchInfoWorkspaceId,
        updateSettings
    } = useWorkspace()
    const { t } = useTranslation()
    const { toast } = useToast()
    const promptedWorkspaceIds = useRef(new Set<string>())
    const locationRequestInFlight = useRef(false)
    const [open, setOpen] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        const workspaceId = user?.workspaceId
        const hasCoordination = Boolean(features.coordination?.trim())

        if (
            isLoading
            || !workspaceId
            || loadedWorkspaceId !== workspaceId
            || resolvedBranchInfoWorkspaceId !== workspaceId
            || branchInfo?.isBranch
            || user?.role !== 'admin'
            || !features.is_configured
            || features.data_mode === 'demo'
            || user?.workspaceMode === 'demo'
            || promptedWorkspaceIds.current.has(workspaceId)
        ) {
            if (
                loadedWorkspaceId !== workspaceId
                || resolvedBranchInfoWorkspaceId !== workspaceId
                || branchInfo?.isBranch
            ) {
                setOpen(false)
            }
            return
        }

        promptedWorkspaceIds.current.add(workspaceId)
        setOpen(!hasCoordination)
    }, [branchInfo?.isBranch, features.coordination, features.data_mode, features.is_configured, isLoading, loadedWorkspaceId, resolvedBranchInfoWorkspaceId, user?.role, user?.workspaceId, user?.workspaceMode])

    const getLocationErrorMessage = (error: GeolocationPositionError) => {
        if (error.code === error.PERMISSION_DENIED) {
            return t('workspaceConfig.location.permissionDenied')
        }
        if (error.code === error.POSITION_UNAVAILABLE) {
            return t('workspaceConfig.location.deviceLocationDisabled')
        }
        if (error.code === error.TIMEOUT) {
            return t('workspaceConfig.location.timeout')
        }
        return t('workspaceConfig.location.failed')
    }

    const handleShareLocation = async () => {
        if (isSaving || locationRequestInFlight.current) return

        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            toast({
                title: t('common.error'),
                description: t('workspaceConfig.location.unsupported'),
                variant: 'destructive'
            })
            return
        }

        locationRequestInFlight.current = true
        let position: GeolocationPosition
        try {
            position = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 0
                })
            })
        } catch (error: unknown) {
            const message = typeof error === 'object' && error !== null && 'code' in error
                ? getLocationErrorMessage(error as GeolocationPositionError)
                : error instanceof Error
                    ? error.message
                    : t('workspaceConfig.location.failed')
            toast({
                title: t('common.error'),
                description: message,
                variant: 'destructive'
            })
            locationRequestInFlight.current = false
            return
        }

        setIsSaving(true)
        try {
            await updateSettings({
                coordination: formatCoordination(position.coords.latitude, position.coords.longitude)
            })
            setOpen(false)
            toast({
                title: t('common.success'),
                description: t('workspaceConfig.location.saved')
            })
        } catch (error: unknown) {
            const message = typeof error === 'object' && error !== null && 'code' in error
                ? getLocationErrorMessage(error as GeolocationPositionError)
                : error instanceof Error
                    ? error.message
                    : t('workspaceConfig.location.failed')
            toast({
                title: t('common.error'),
                description: message,
                variant: 'destructive'
            })
        } finally {
            setIsSaving(false)
            locationRequestInFlight.current = false
        }
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => { if (nextOpen) setOpen(true) }}>
            <DialogContent
                className="sm:max-w-md"
                showCloseButton={false}
                onPointerDownOutside={(event) => event.preventDefault()}
                onEscapeKeyDown={(event) => event.preventDefault()}
            >
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-primary" />
                        {t('workspaceConfig.location.title')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('workspaceConfig.location.desc')}
                    </DialogDescription>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                    {t('workspaceConfig.location.example')}
                </p>
                <DialogFooter>
                    <Button type="button" onClick={handleShareLocation} disabled={isSaving}>
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                        {t('workspaceConfig.location.cta')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
