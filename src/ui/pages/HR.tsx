import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Mail, Phone, Trash2, Edit, AlertTriangle, MessageCircle } from 'lucide-react'
import { useLocation } from 'wouter'
import { useWorkspace } from '@/workspace'
import { useEmployees, createEmployee, updateEmployee, deleteEmployee, useWorkspaceUsers } from '@/local-db'
import type { Employee } from '@/local-db'
import { platformService } from '@/services/platformService'
import { whatsappManager } from '@/lib/whatsappWebviewManager'
import {
    Button,
    Input,
    Card, CardContent,
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
    Label,
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
    Switch,
    useToast
} from '@/ui/components'
import { formatDate, formatCurrency, cn, formatNumberWithCommas, parseFormattedNumber } from '@/lib/utils'
import { DeleteConfirmationModal } from '@/ui/components/DeleteConfirmationModal'
import { FireConfirmationModal } from '@/ui/components/FireConfirmationModal'

const ROLE_HIERARCHY: Record<string, string[]> = {
    'Management': ['Manager', 'Assistant Manager', 'Supervisor'],
    'Staff': ['Salesman', 'Cashier', 'Accountant', 'Security', 'Cleaning', 'Driver'],
    'Technical': ['IT Support', 'Maintenance', 'Developer']
}

export default function HR() {
    const { t } = useTranslation()
    const { toast } = useToast()
    const { activeWorkspace, features } = useWorkspace()
    const workspaceId = activeWorkspace?.id
    const baseCurrency = features.default_currency
    const employees = useEmployees(workspaceId)
    const [search, setSearch] = useState('')
    const [, setLocation] = useLocation()
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingEmployee, setEditingEmployee] = useState<Employee | undefined>(undefined)
    const workspaceUsers = useWorkspaceUsers(workspaceId)

    const [selectedCategory, setSelectedCategory] = useState<string>('')
    const [selectedRole, setSelectedRole] = useState<string>('')
    const [hasDividends, setHasDividends] = useState(false)
    const [dividendType, setDividendType] = useState<'fixed' | 'percentage'>('fixed')
    const [dividendCurrency, setDividendCurrency] = useState<string>(features.default_currency || 'usd')
    const [salaryPayday, setSalaryPayday] = useState<number>(30)
    const [dividendPayday, setDividendPayday] = useState<number>(30)
    const [salaryDisplay, setSalaryDisplay] = useState<string>('')
    const [dividendAmountDisplay, setDividendAmountDisplay] = useState<string>('')

    const [showLinkAccount, setShowLinkAccount] = useState(false)
    const [linkedUserId, setLinkedUserId] = useState<string | undefined>(undefined)

    // Confirmation Modals State
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isFireModalOpen, setIsFireModalOpen] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [confirmTarget, setConfirmTarget] = useState<Employee | undefined>(undefined)

    useMemo(() => {
        if (editingEmployee) {
            const [cat, role] = editingEmployee.role.includes(':')
                ? editingEmployee.role.split(':')
                : ['', editingEmployee.role]
            setSelectedCategory(cat || '')
            setSelectedRole(role || editingEmployee.role || '')
            setHasDividends(editingEmployee.hasDividends || false)
            setDividendType(editingEmployee.dividendType || 'fixed')
            setDividendCurrency(editingEmployee.dividendCurrency || features.default_currency || 'usd')
            setSalaryPayday(editingEmployee.salaryPayday || 30)
            setDividendPayday(editingEmployee.dividendPayday || 30)
            setSalaryDisplay(formatNumberWithCommas(editingEmployee.salary || 0))
            setDividendAmountDisplay(formatNumberWithCommas(editingEmployee.dividendAmount || 0))
            setShowLinkAccount(!!editingEmployee.linkedUserId)
            setLinkedUserId(editingEmployee.linkedUserId)
        } else if (isDialogOpen === false) {
            setSelectedCategory('')
            setSelectedRole('')
            setHasDividends(false)
            setDividendType('fixed')
            setDividendCurrency(features.default_currency || 'usd')
            setSalaryPayday(30)
            setDividendPayday(30)
            setSalaryDisplay('')
            setDividendAmountDisplay('')
            setShowLinkAccount(false)
            setLinkedUserId(undefined)
        }
    }, [editingEmployee, isDialogOpen, features.default_currency])

    const filteredEmployees = useMemo(() => {
        return employees.filter(e =>
            e.name.toLowerCase().includes(search.toLowerCase()) ||
            e.role.toLowerCase().includes(search.toLowerCase()) ||
            e.email?.toLowerCase().includes(search.toLowerCase())
        )
    }, [employees, search])

    const othersTotalPercentage = useMemo(() => {
        return employees
            .filter(emp => emp.id !== editingEmployee?.id && emp.hasDividends && emp.dividendType === 'percentage' && !emp.isFired)
            .reduce((sum, emp) => sum + (emp.dividendAmount || 0), 0)
    }, [employees, editingEmployee])

    const availablePercentage = Math.max(0, 100 - othersTotalPercentage)

    const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!workspaceId || isSaving) return

        const formData = new FormData(e.currentTarget)

        if (hasDividends && dividendType === 'percentage') {
            const newPercentage = parseFormattedNumber(dividendAmountDisplay)
            if (othersTotalPercentage + newPercentage > 100) {
                toast({
                    variant: 'destructive',
                    description: t('hr.dividendExceeds', `Total dividends cannot exceed 100%. Available: ${availablePercentage}%`)
                })
                return
            }
        }
        const data = {
            name: formData.get('name') as string,
            email: formData.get('email') as string,
            phone: formData.get('phone') as string,
            role: `${selectedCategory}:${selectedRole}`,
            gender: formData.get('gender') as 'male' | 'female' | 'other',
            location: formData.get('location') as string,
            joiningDate: formData.get('joiningDate') as string,
            salary: parseFormattedNumber(salaryDisplay),
            salaryCurrency: (formData.get('salaryCurrency') as any) || baseCurrency || 'usd',
            hasDividends,
            dividendType: hasDividends ? dividendType : undefined,
            dividendAmount: hasDividends ? parseFormattedNumber(dividendAmountDisplay) : undefined,
            dividendCurrency: hasDividends ? (dividendCurrency as any) : undefined,
            salaryPayday,
            dividendPayday: hasDividends ? dividendPayday : undefined,
            isFired: editingEmployee?.isFired || false,
            linkedUserId: showLinkAccount ? linkedUserId : undefined
        }

        setIsSaving(true)
        // Optimistically close for better UX
        setIsDialogOpen(false)

        try {
            if (editingEmployee) {
                await updateEmployee(editingEmployee.id, data)
                toast({ description: t('hr.updateSuccess', 'Employee updated successfully') })
            } else {
                await createEmployee(workspaceId, data)
                toast({ description: t('hr.addSuccess', 'Employee added successfully') })
            }
            setEditingEmployee(undefined)
        } catch (error) {
            console.error('Save error:', error)
            toast({ variant: 'destructive', description: t('common.error', 'Something went wrong') })
            setIsDialogOpen(true) // Re-open on error
        } finally {
            setIsSaving(false)
        }
    }

    const handleDeleteClick = (employee: Employee) => {
        setConfirmTarget(employee)
        setIsDeleteModalOpen(true)
    }

    const handleConfirmDelete = async () => {
        if (!confirmTarget) return
        try {
            await deleteEmployee(confirmTarget.id)
            toast({ description: t('hr.deleteSuccess', 'Employee removed successfully') })
            setIsDeleteModalOpen(false)
            setConfirmTarget(undefined)
        } catch (error) {
            toast({ variant: 'destructive', description: t('common.error', 'Something went wrong') })
        }
    }

    const handleFireClick = (employee: Employee) => {
        setConfirmTarget(employee)
        setIsFireModalOpen(true)
    }

    const handleConfirmFire = async () => {
        if (!confirmTarget) return
        try {
            await updateEmployee(confirmTarget.id, { isFired: !confirmTarget.isFired })
            toast({ description: confirmTarget.isFired ? t('hr.rehireSuccess', 'Employee rehired') : t('hr.fireSuccess', 'Employee fired') })
            setIsFireModalOpen(false)
            setConfirmTarget(undefined)
        } catch (error) {
            toast({ variant: 'destructive', description: t('common.error', 'Something went wrong') })
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{t('nav.hr', 'HR')}</h1>
                    <p className="text-muted-foreground">{t('hr.subtitle', 'Manage your team and payroll')}</p>
                </div>
                <Button onClick={() => setIsDialogOpen(true)} className="gap-2">
                    <Plus className="w-4 h-4" />
                    {t('hr.addEmployee', 'Add Employee')}
                </Button>
            </div>

            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder={t('hr.searchPlaceholder', 'Search by name, role, or email...')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {filteredEmployees.map((employee) => (
                    <Card key={employee.id} className={cn(
                        "group hover:border-primary/50 transition-all bg-secondary/20 overflow-hidden",
                        employee.isFired && "opacity-60 grayscale-[0.8] brightness-90"
                    )}>
                        {employee.isFired && (
                            <div className="absolute top-2 right-12 px-2 py-0.5 bg-destructive/10 text-destructive text-[10px] font-black uppercase rounded-full">
                                {t('hr.firedLabel', 'Suspended / Fired')}
                            </div>
                        )}
                        <CardContent className="p-6">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary overflow-hidden">
                                        {(() => {
                                            const linkedUser = workspaceUsers.find(u => u.id === employee.linkedUserId);
                                            const profileUrl = linkedUser?.profileUrl;

                                            if (employee.linkedUserId && profileUrl) {
                                                return (
                                                    <img
                                                        src={platformService.convertFileSrc(profileUrl)}
                                                        className="w-full h-full object-cover"
                                                        alt={employee.name}
                                                        onError={(e) => {
                                                            (e.target as any).style.display = 'none';
                                                            (e.target as any).parentElement.innerHTML = `<span class="font-bold text-lg">${employee.name[0]}</span>`;
                                                        }}
                                                    />
                                                );
                                            }

                                            return <span className="font-bold text-lg">{employee.name[0]}</span>;
                                        })()}
                                    </div>
                                    <div>
                                        <div className="font-bold text-lg">{employee.name}</div>
                                        <div className="text-xs font-black uppercase tracking-widest text-primary/70">
                                            {employee.role.includes(':') ? employee.role.split(':')[1] : employee.role}
                                        </div>
                                        {employee.role.includes(':') && (
                                            <div className="text-[10px] text-muted-foreground/50 font-bold uppercase tracking-tighter -mt-0.5">
                                                {employee.role.split(':')[0]}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className={cn(employee.isFired ? "text-primary" : "text-destructive")}
                                        onClick={() => handleFireClick(employee)}
                                    >
                                        <Plus className={cn("w-4 h-4", !employee.isFired && "rotate-45")} />
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => {
                                        setEditingEmployee(employee)
                                        setIsDialogOpen(true)
                                    }}>
                                        <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDeleteClick(employee)}>
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="mt-6 space-y-3">
                                {employee.email && (
                                    <div className="flex items-center gap-2 text-sm">
                                        <Mail className="w-4 h-4 text-muted-foreground" />
                                        <span>{employee.email}</span>
                                    </div>
                                )}
                                {employee.phone && (
                                    <div className="flex items-center justify-between gap-2 text-sm w-full group/phone">
                                        <div className="flex items-center gap-2">
                                            <Phone className="w-4 h-4 text-muted-foreground" />
                                            <span>{employee.phone}</span>
                                        </div>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                if (employee.phone) {
                                                    whatsappManager.openChat(employee.phone)
                                                    setLocation('/whatsapp')
                                                }
                                            }}
                                            title="Open WhatsApp Chat"
                                        >
                                            <MessageCircle className="w-4 h-4" />
                                        </Button>
                                    </div>
                                )}
                                <div className="space-y-2 pt-4 border-t border-border/50">
                                    <div className="flex justify-between items-center">
                                        <div className="text-sm font-medium">
                                            <div className="text-muted-foreground text-xs">{t('hr.salary', 'Salary')}</div>
                                            <div className="text-primary font-bold">
                                                {formatCurrency(employee.salary, employee.salaryCurrency, features.iqd_display_preference)}
                                            </div>
                                        </div>
                                        <div className="text-sm text-end">
                                            <div className="text-muted-foreground text-xs">{t('hr.joined', 'Joined')}</div>
                                            <div className="font-medium">{formatDate(employee.joiningDate)}</div>
                                        </div>
                                    </div>

                                    {employee.hasDividends && employee.dividendAmount && employee.dividendAmount > 0 && (
                                        <div className="flex justify-between items-center pt-2 border-t border-dashed border-border/30">
                                            <div className="text-[10px] font-black uppercase text-muted-foreground opacity-60">
                                                {t('hr.dividends', 'Dividends / Equity')}
                                            </div>
                                            <div className="text-xs font-bold text-primary italic">
                                                {employee.dividendType === 'percentage'
                                                    ? `${employee.dividendAmount}%`
                                                    : formatCurrency(employee.dividendAmount, employee.dividendCurrency, features.iqd_display_preference)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={isDialogOpen} onOpenChange={(open) => {
                setIsDialogOpen(open)
                if (!open) setEditingEmployee(undefined)
            }}>
                <DialogContent className="max-w-2xl w-[95vw] sm:w-full max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingEmployee ? t('hr.editEmployee', 'Edit Employee') : t('hr.addEmployee', 'Add Employee')}</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSave} className="space-y-4 pt-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2 col-span-2">
                                <Label htmlFor="name">{t('hr.form.name', 'Full Name')}</Label>
                                <Input id="name" name="name" defaultValue={editingEmployee?.name} required />
                            </div>
                            <div className="space-y-2">
                                <Label>{t('hr.form.category', 'Department / Category')}</Label>
                                <Select
                                    value={selectedCategory}
                                    onValueChange={(val) => {
                                        setSelectedCategory(val)
                                        setSelectedRole('')
                                    }}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('hr.form.selectCategory', 'Select Category')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Object.keys(ROLE_HIERARCHY).map(cat => (
                                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>{t('hr.form.role', 'Specific Role')}</Label>
                                <Select
                                    value={selectedRole}
                                    onValueChange={setSelectedRole}
                                    disabled={!selectedCategory}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={t('hr.form.selectRole', 'Select Role')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(ROLE_HIERARCHY[selectedCategory] || []).map(role => (
                                            <SelectItem key={role} value={role}>{role}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="gender">{t('hr.form.gender', 'Gender')}</Label>
                                <Select name="gender" defaultValue={editingEmployee?.gender || 'male'}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="male">{t('hr.form.male', 'Male')}</SelectItem>
                                        <SelectItem value="female">{t('hr.form.female', 'Female')}</SelectItem>
                                        <SelectItem value="other">{t('hr.form.other', 'Other')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">{t('hr.form.email', 'Email')}</Label>
                                <Input id="email" name="email" type="email" defaultValue={editingEmployee?.email} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="phone">{t('hr.form.phone', 'Phone')}</Label>
                                <Input id="phone" name="phone" defaultValue={editingEmployee?.phone} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="salary">{t('hr.form.salary', 'Salary')}</Label>
                                <div className="flex gap-2">
                                    <Input
                                        id="salary"
                                        name="salary"
                                        className="flex-1"
                                        value={salaryDisplay}
                                        onChange={(e) => setSalaryDisplay(formatNumberWithCommas(e.target.value))}
                                        placeholder="0"
                                        required={!hasDividends}
                                    />
                                    <Select name="salaryCurrency" defaultValue={editingEmployee?.salaryCurrency || baseCurrency || 'usd'}>
                                        <SelectTrigger className="w-[80px]">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="usd">USD</SelectItem>
                                            <SelectItem value="iqd">IQD</SelectItem>
                                            <SelectItem value="eur">EUR</SelectItem>
                                            <SelectItem value="try">TRY</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="salaryPayday">{t('hr.form.salaryPayday', 'Salary Payday (1-31)')}</Label>
                                <Input
                                    id="salaryPayday"
                                    type="number"
                                    min="1"
                                    max="31"
                                    value={salaryPayday}
                                    onChange={(e) => setSalaryPayday(Number(e.target.value))}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="joiningDate">{t('hr.form.joiningDate', 'Joining Date')}</Label>
                                <Input id="joiningDate" name="joiningDate" type="date" defaultValue={editingEmployee?.joiningDate ? new Date(editingEmployee.joiningDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]} required />
                            </div>

                            {/* Link Workspace Account - Requirement: between salary payday/joining date and location */}
                            <div className="col-span-2 p-4 bg-primary/5 rounded-lg space-y-4 border border-primary/20">
                                <div className="flex items-center justify-between">
                                    <div className="space-y-0.5">
                                        <Label className="text-sm font-bold uppercase tracking-wider text-primary">{t('hr.form.linkAccount', 'Link Workspace Account')}</Label>
                                        <div className="text-[10px] text-muted-foreground uppercase">{t('hr.form.linkAccountDesc', 'Connect this record to a workspace member account')}</div>
                                    </div>
                                    <Switch checked={showLinkAccount} onCheckedChange={(val) => {
                                        setShowLinkAccount(val)
                                        if (!val) setLinkedUserId(undefined)
                                    }} />
                                </div>

                                {showLinkAccount && (
                                    <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                                        <Select value={linkedUserId} onValueChange={setLinkedUserId}>
                                            <SelectTrigger>
                                                <SelectValue placeholder={t('hr.form.selectMember', 'Select Member')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {workspaceUsers.map(user => (
                                                    <SelectItem key={user.id} value={user.id}>
                                                        {user.name}{user.email ? ` (${user.email})` : ''}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2 col-span-2">
                                <Label htmlFor="location">{t('hr.form.location', 'Location')}</Label>
                                <Input id="location" name="location" defaultValue={editingEmployee?.location} />
                            </div>

                            {selectedCategory === 'Management' && (
                                <div className="col-span-2 p-4 bg-muted/30 rounded-lg space-y-4 border border-border/50">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <Label className="text-sm font-bold uppercase tracking-wider">{t('hr.form.dividends', 'Ownership / Dividends')}</Label>
                                            <div className="text-[10px] text-muted-foreground uppercase">{t('hr.form.dividendDesc', 'Enable profit-sharing for this management member')}</div>
                                        </div>
                                        <Switch checked={hasDividends} onCheckedChange={setHasDividends} />
                                    </div>

                                    {hasDividends && (
                                        <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-1 duration-200">
                                            <div className="space-y-2">
                                                <Label className="text-xs uppercase">{t('hr.form.dividendType', 'Calculation')}</Label>
                                                <Select value={dividendType} onValueChange={(val: any) => setDividendType(val)}>
                                                    <SelectTrigger>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="fixed">{t('hr.form.fixedValue', 'Manual Value')}</SelectItem>
                                                        <SelectItem value="percentage">{t('hr.form.percentageValue', 'Percentage (%)')}</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-xs uppercase">{t('hr.form.payday', 'Dividend Payday (1-31)')}</Label>
                                                <Input
                                                    type="number"
                                                    min="1"
                                                    max="31"
                                                    value={dividendPayday}
                                                    onChange={(e) => setDividendPayday(Number(e.target.value))}
                                                    required
                                                />
                                            </div>
                                            <div className="space-y-2 col-span-2">
                                                <Label className="text-xs uppercase">{t('hr.form.amount', 'Amount')}</Label>
                                                <div className="flex gap-1.5">
                                                    <Input
                                                        value={dividendAmountDisplay}
                                                        onChange={(e) => setDividendAmountDisplay(formatNumberWithCommas(e.target.value))}
                                                        className="flex-1"
                                                        placeholder="0"
                                                    />
                                                    {dividendType === 'percentage' ? (
                                                        <div className="w-10 h-10 flex items-center justify-center bg-muted rounded-md text-sm font-bold">%</div>
                                                    ) : (
                                                        <Select value={dividendCurrency} onValueChange={setDividendCurrency}>
                                                            <SelectTrigger className="w-[80px]">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="usd">USD</SelectItem>
                                                                <SelectItem value="iqd">IQD</SelectItem>
                                                                <SelectItem value="eur">EUR</SelectItem>
                                                                <SelectItem value="try">TRY</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                                </div>
                                                {dividendType === 'percentage' && (
                                                    <div className={cn(
                                                        "flex items-center gap-1.5 mt-1.5 text-[11px] font-bold",
                                                        availablePercentage <= 0 ? 'text-destructive' : 'text-muted-foreground'
                                                    )}>
                                                        {availablePercentage <= 0 ? (
                                                            <><AlertTriangle className="w-3 h-3" /> {t('hr.noPercentageLeft', 'No percentage available (100% allocated)')}</>
                                                        ) : (
                                                            <>{t('hr.availablePercentage', `Available: ${availablePercentage}%`)}</>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <DialogFooter className="pt-4">
                            <Button type="submit">{editingEmployee ? t('common.update', 'Update') : t('common.save', 'Save')}</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <DeleteConfirmationModal
                isOpen={isDeleteModalOpen}
                onClose={() => {
                    setIsDeleteModalOpen(false)
                    setConfirmTarget(undefined)
                }}
                onConfirm={handleConfirmDelete}
                itemName={confirmTarget?.name}
                title={t('hr.deleteTitle', 'Remove Employee')}
                description={t('hr.deleteWarning', 'This will permanently remove this employee from the records. This action cannot be undone.')}
            />

            <FireConfirmationModal
                isOpen={isFireModalOpen}
                onClose={() => {
                    setIsFireModalOpen(false)
                    setConfirmTarget(undefined)
                }}
                onConfirm={handleConfirmFire}
                employeeName={confirmTarget?.name || ''}
                isFired={confirmTarget?.isFired || false}
            />
        </div>
    )
}
