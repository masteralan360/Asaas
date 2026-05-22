import { useTranslation } from 'react-i18next'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    Button,
} from '@/ui/components'
import { useProfileData } from '@/hooks/useProfileData'
import { Loader2, User, Shield, Calendar, AlertCircle, Ban, Mail, Briefcase, Hash } from 'lucide-react'
import { platformService } from '@/services/platformService'
import { formatDocumentDate } from '@/lib/utils'

interface ProfileCardModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    userId: string | null
}

const roleColors: Record<string, string> = {
    admin: 'bg-purple-500/10 text-purple-500',
    staff: 'bg-blue-500/10 text-blue-500',
    viewer: 'bg-slate-500/10 text-slate-500'
}

function RoleBadge({ role }: { role: string }) {
    const { t } = useTranslation()
    const icons: Record<string, React.ReactNode> = {
        admin: <Shield className="w-3 h-3" />,
        staff: <Briefcase className="w-3 h-3" />,
        viewer: <Mail className="w-3 h-3" />
    }

    return (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${roleColors[role] || ''}`}>
            {icons[role] || null}
            {t(`auth.roles.${role}`)}
        </span>
    )
}

function ProfileSection({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                <Icon className="w-4 h-4" />
                <span>{title}</span>
            </div>
            <div className="rounded-xl border bg-card p-4 space-y-3">
                {children}
            </div>
        </div>
    )
}

function ProfileField({ label, value, icon: Icon }: { label: string; value: React.ReactNode; icon?: React.ElementType }) {
    return (
        <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {Icon && <Icon className="w-3.5 h-3.5 shrink-0" />}
                <span>{label}</span>
            </div>
            <div className="text-sm font-medium text-right break-all">{value}</div>
        </div>
    )
}

export function ProfileCardModal({ open, onOpenChange, userId }: ProfileCardModalProps) {
    const { t } = useTranslation()
    const { profile, isLoading, error, isCurrentUser } = useProfileData(userId)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px] max-h-[85vh] overflow-y-auto" aria-label={t('profileCard.title')}>
                <DialogHeader>
                    <DialogTitle>{t('profileCard.title')}</DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                        <AlertCircle className="w-8 h-8 text-destructive" />
                        <p className="text-sm text-muted-foreground">{error}</p>
                        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                            {t('profileCard.close')}
                        </Button>
                    </div>
                ) : !profile ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                        <Ban className="w-8 h-8 text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">{t('profileCard.notFound')}</p>
                        <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                            {t('profileCard.close')}
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* Avatar + Name Header */}
                        <div className="flex items-center gap-4 pb-2">
                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center text-xl font-bold text-white overflow-hidden shadow-sm shrink-0">
                                {profile.profile_url ? (
                                    <img
                                        src={profile.profile_url.startsWith('http') ? profile.profile_url : platformService.convertFileSrc(profile.profile_url)}
                                        alt={profile.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    profile.name?.charAt(0).toUpperCase() || '?'
                                )}
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-lg font-semibold truncate">
                                    {profile.name}
                                    {isCurrentUser && (
                                        <span className="ms-2 text-xs text-muted-foreground whitespace-nowrap">
                                            ({t('profileCard.currentUser')})
                                        </span>
                                    )}
                                </h2>
                                <div className="mt-1">
                                    <RoleBadge role={profile.role} />
                                </div>
                            </div>
                        </div>

                        {/* Basic Information */}
                        <ProfileSection title={t('profileCard.sections.basicInfo')} icon={User}>
                            <ProfileField label={t('profileCard.fields.userId')} value={profile.id} icon={Hash} />
                        </ProfileSection>

                        {/* Account Details */}
                        <ProfileSection title={t('profileCard.sections.account')} icon={Briefcase}>
                            <ProfileField
                                label={t('profileCard.fields.joinedAt')}
                                value={formatDocumentDate(profile.created_at)}
                                icon={Calendar}
                            />
                        </ProfileSection>

                        {/* Roles & Permissions */}
                        <ProfileSection title={t('profileCard.sections.roles')} icon={Shield}>
                            <ProfileField
                                label={t('profileCard.fields.role')}
                                value={<RoleBadge role={profile.role} />}
                            />
                        </ProfileSection>

                        {/* Contact Information */}
                        <ProfileSection title={t('profileCard.sections.contact')} icon={Mail}>
                            <p className="text-sm text-muted-foreground text-center py-2">
                                {t('profileCard.noContactInfo')}
                            </p>
                        </ProfileSection>

                        {/* Activity / Metadata */}
                        <ProfileSection title={t('profileCard.sections.activity')} icon={Calendar}>
                            <p className="text-sm text-muted-foreground">
                                {t('profileCard.memberSince', { date: formatDocumentDate(profile.created_at) })}
                            </p>
                        </ProfileSection>
                    </div>
                )}

                {profile && !isLoading && !error && (
                    <div className="flex justify-end pt-4 border-t mt-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>
                            {t('profileCard.close')}
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
