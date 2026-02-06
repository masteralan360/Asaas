import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Search, User, Mail, Phone, Trash2, Edit } from 'lucide-react'
import { useWorkspace } from '@/workspace'
import { useEmployees, createEmployee, updateEmployee, deleteEmployee } from '@/local-db'
import type { Employee } from '@/local-db'
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
import { formatDate, formatCurrency } from '@/lib/utils'

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
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingEmployee, setEditingEmployee] = useState<Employee | undefined>(undefined)

    const [selectedCategory, setSelectedCategory] = useState<string>('')
    const [selectedRole, setSelectedRole] = useState<string>('')
    const [hasDividends, setHasDividends] = useState(false)
    const [dividendType, setDividendType] = useState<'fixed' | 'percentage'>('fixed')
    const [dividendAmount, setDividendAmount] = useState<number>(0)
    const [dividendCurrency, setDividendCurrency] = useState<string>(features.default_currency || 'usd')

    useMemo(() => {
        if (editingEmployee) {
            const [cat, role] = editingEmployee.role.includes(':')
                ? editingEmployee.role.split(':')
                : ['', editingEmployee.role]
            setSelectedCategory(cat || '')
            setSelectedRole(role || editingEmployee.role || '')
            setHasDividends(editingEmployee.hasDividends || false)
            setDividendType(editingEmployee.dividendType || 'fixed')
            setDividendAmount(editingEmployee.dividendAmount || 0)
            setDividendCurrency(editingEmployee.dividendCurrency || features.default_currency || 'usd')
        } else if (isDialogOpen === false) {
            setSelectedCategory('')
            setSelectedRole('')
            setHasDividends(false)
            setDividendType('fixed')
            setDividendAmount(0)
            setDividendCurrency(features.default_currency || 'usd')
        }
    }, [editingEmployee, isDialogOpen, features.default_currency])

    const filteredEmployees = useMemo(() => {
        return employees.filter(e =>
            e.name.toLowerCase().includes(search.toLowerCase()) ||
            e.role.toLowerCase().includes(search.toLowerCase()) ||
            e.email?.toLowerCase().includes(search.toLowerCase())
        )
    }, [employees, search])

    const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (!workspaceId) return

        const formData = new FormData(e.currentTarget)
        const data = {
            name: formData.get('name') as string,
            email: formData.get('email') as string,
            phone: formData.get('phone') as string,
            role: `${selectedCategory}:${selectedRole}`,
            gender: formData.get('gender') as 'male' | 'female' | 'other',
            location: formData.get('location') as string,
            joiningDate: formData.get('joiningDate') as string,
            salary: Number(formData.get('salary')),
            salaryCurrency: (formData.get('salaryCurrency') as any) || baseCurrency || 'usd',
            hasDividends,
            dividendType: hasDividends ? dividendType : undefined,
            dividendAmount: hasDividends ? dividendAmount : undefined,
            dividendCurrency: hasDividends ? (dividendCurrency as any) : undefined,
        }

        try {
            if (editingEmployee) {
                await updateEmployee(editingEmployee.id, data)
                toast({ description: t('hr.updateSuccess', 'Employee updated successfully') })
            } else {
                await createEmployee(workspaceId, data)
                toast({ description: t('hr.addSuccess', 'Employee added successfully') })
            }
            setIsDialogOpen(false)
            setEditingEmployee(undefined)
        } catch (error) {
            toast({ variant: 'destructive', description: t('common.error', 'Something went wrong') })
        }
    }

    const handleDelete = async (id: string) => {
        if (confirm(t('common.confirmDelete', 'Are you sure?'))) {
            try {
                await deleteEmployee(id)
                toast({ description: t('hr.deleteSuccess', 'Employee removed successfully') })
            } catch (error) {
                toast({ variant: 'destructive', description: t('common.error', 'Something went wrong') })
            }
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
                    <Card key={employee.id} className="group hover:border-primary/50 transition-colors bg-secondary/20">
                        <CardContent className="p-6">
                            <div className="flex items-start justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                                        <User className="w-6 h-6" />
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
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="icon" onClick={() => {
                                        setEditingEmployee(employee)
                                        setIsDialogOpen(true)
                                    }}>
                                        <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => handleDelete(employee.id)}>
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
                                    <div className="flex items-center gap-2 text-sm">
                                        <Phone className="w-4 h-4 text-muted-foreground" />
                                        <span>{employee.phone}</span>
                                    </div>
                                )}
                                <div className="flex justify-between items-center pt-4 border-t border-border/50">
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
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Dialog open={isDialogOpen} onOpenChange={(open) => {
                setIsDialogOpen(open)
                if (!open) setEditingEmployee(undefined)
            }}>
                <DialogContent>
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
                                    <Input id="salary" name="salary" type="number" className="flex-1" defaultValue={editingEmployee?.salary} required={!hasDividends} />
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
                                <Label htmlFor="joiningDate">{t('hr.form.joiningDate', 'Joining Date')}</Label>
                                <Input id="joiningDate" name="joiningDate" type="date" defaultValue={editingEmployee?.joiningDate ? new Date(editingEmployee.joiningDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]} required />
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
                                                <Label className="text-xs uppercase">{t('hr.form.amount', 'Amount')}</Label>
                                                <div className="flex gap-1.5">
                                                    <Input
                                                        type="number"
                                                        value={dividendAmount}
                                                        onChange={(e) => setDividendAmount(Number(e.target.value))}
                                                        className="flex-1"
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
        </div>
    )
}
