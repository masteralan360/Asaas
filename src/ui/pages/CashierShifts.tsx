import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Check, Clock3, Plus, ShieldCheck, UserRound, WalletCards, X } from 'lucide-react'

import { useAuth } from '@/auth'
import { useDateRange } from '@/context/DateRangeContext'
import {
  createCashierShiftAssignment,
  createCashierShiftTemplate,
  getCashierShiftOccurrenceBounds,
  isCashierShiftWorkingDay,
  startCashierShiftOccurrence,
  type CashierShiftAssignment,
  type PaymentAccount,
  useCashierShiftAssignments,
  useCashierShiftOccurrences,
  useCashierShiftTemplates,
  useWorkspaceUsers,
} from '@/local-db'
import { isDateInDateRange } from '@/lib/dateRangeFilters'
import { formatTime } from '@/lib/utils'
import { useWorkspacePermissions } from '@/permissions'
import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogDescription,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateRangeFilters,
  DateTimePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@/ui/components'
import { PaymentAccountSelector } from '@/ui/components/payments/PaymentAccountSelector'
import { PressAndHoldButton } from '@/ui/components/PressAndHoldButton'
import { useWorkspace } from '@/workspace'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
const DEFAULT_TIME_DATE = new Date(2000, 0, 1, 8, 0, 0, 0)
const DEFAULT_END_TIME_DATE = new Date(2000, 0, 1, 16, 0, 0, 0)

type ShiftDisplayStatus = 'upcoming' | 'available' | 'active' | 'completed' | 'unavailable'

interface ShiftDisplayRow {
  key: string
  assignment: CashierShiftAssignment
  scheduledStartAt: string
  scheduledEndAt: string
  status: ShiftDisplayStatus
}

function timeKey(value: Date | undefined) {
  if (!value) return ''
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function isOvernight(startTime: string, endTime: string) {
  return Boolean(startTime && endTime && endTime <= startTime)
}

function statusClass(status: ShiftDisplayStatus) {
  switch (status) {
    case 'available': return 'border-primary/20 bg-primary/10 text-primary'
    case 'active': return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
    case 'completed': return 'border-slate-500/20 bg-slate-500/10 text-muted-foreground'
    case 'unavailable': return 'border-amber-500/20 bg-amber-500/10 text-amber-700'
    default: return 'border-sky-500/20 bg-sky-500/10 text-sky-700'
  }
}

export function CashierShifts() {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const { user } = useAuth()
  const { hasFeature } = useWorkspace()
  const { hasPermission } = useWorkspacePermissions()
  const { dateRange, customDates } = useDateRange()
  const workspaceId = user?.workspaceId
  const currentUserId = user?.id
  const members = useWorkspaceUsers(workspaceId)
  const templates = useCashierShiftTemplates(workspaceId)
  const assignments = useCashierShiftAssignments(workspaceId)
  const occurrences = useCashierShiftOccurrences(workspaceId)
  const enabled = hasFeature('payment_accounts')
    && hasFeature('cashier_shift_control')
    && hasPermission('paymentAccounts.access')
    && hasPermission('cashierShiftControl.access')

  const [activeTab, setActiveTab] = useState<'shifts' | 'assignments'>('shifts')
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [startDialogRow, setStartDialogRow] = useState<ShiftDisplayRow | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savingAssignment, setSavingAssignment] = useState(false)
  const [startingShift, setStartingShift] = useState(false)

  const [templateName, setTemplateName] = useState('')
  const [templateStartTime, setTemplateStartTime] = useState<Date | undefined>(new Date(DEFAULT_TIME_DATE))
  const [templateEndTime, setTemplateEndTime] = useState<Date | undefined>(new Date(DEFAULT_END_TIME_DATE))

  const [cashDrawer, setCashDrawer] = useState<PaymentAccount | null>(null)
  const [cashierUserId, setCashierUserId] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('__custom__')
  const [assignmentStartTime, setAssignmentStartTime] = useState<Date | undefined>(new Date(DEFAULT_TIME_DATE))
  const [assignmentEndTime, setAssignmentEndTime] = useState<Date | undefined>(new Date(DEFAULT_END_TIME_DATE))
  const [workingDays, setWorkingDays] = useState<number[]>([0, 1, 2, 3, 4])

  const workspaceMembers = useMemo(
    () => members.filter((member) => !member.isDeleted)
      .sort((left, right) => (left.name || left.email).localeCompare(right.name || right.email)),
    [members],
  )
  const selectedCashier = useMemo(
    () => workspaceMembers.find((member) => member.id === cashierUserId) ?? null,
    [cashierUserId, workspaceMembers],
  )
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  )
  const activeTemplates = useMemo(() => templates.filter((template) => template.isActive), [templates])
  const activeAssignments = useMemo(() => assignments.filter((assignment) => assignment.isActive), [assignments])
  const myAssignments = useMemo(
    () => activeAssignments.filter((assignment) => assignment.cashierUserId === currentUserId),
    [activeAssignments, currentUserId],
  )
  const visibleAssignments = useMemo(
    () => [...activeAssignments].sort((left, right) => Number(right.cashierUserId === currentUserId) - Number(left.cashierUserId === currentUserId)
      || left.cashierNameSnapshot.localeCompare(right.cashierNameSnapshot)),
    [activeAssignments, currentUserId],
  )

  const weekdayLabel = (day: number) => t(`paymentAccounts.weekdays.${day}`)
  const workingDayList = (days: number[]) => new Intl.ListFormat(i18n.language, { style: 'long', type: 'conjunction' })
    .format([...days].sort((left, right) => left - right).map(weekdayLabel))
  const formatScheduleTime = (value: Date | undefined) => value ? formatTime(value) : t('paymentAccounts.timeNotSet')
  const formatOccurrenceDateTime = (value: string) => new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))

  const shiftRows = useMemo(() => {
    const now = new Date()
    const assignmentById = new Map(myAssignments.map((assignment) => [assignment.id, assignment]))
    const occurrenceByKey = new Map(occurrences.filter((occurrence) => occurrence.cashierUserId === currentUserId)
      .map((occurrence) => [`${occurrence.assignmentId}:${occurrence.scheduledStartAt}`, occurrence]))
    const rows = new Map<string, ShiftDisplayRow>()
    const today = startOfLocalDay(now)

    for (const offset of Array.from({ length: 22 }, (_, index) => index - 7)) {
      const date = new Date(today)
      date.setDate(today.getDate() + offset)
      for (const assignment of myAssignments) {
        if (!isCashierShiftWorkingDay(assignment, date)) continue
        const bounds = getCashierShiftOccurrenceBounds(assignment, date)
        if (!bounds) continue
        const key = `${assignment.id}:${bounds.start.toISOString()}`
        const occurrence = occurrenceByKey.get(key)
        const status: ShiftDisplayStatus = occurrence
          ? now >= bounds.end ? 'completed' : 'active'
          : now < bounds.start ? 'upcoming' : now <= bounds.end ? 'available' : 'unavailable'
        rows.set(key, { key, assignment, scheduledStartAt: bounds.start.toISOString(), scheduledEndAt: bounds.end.toISOString(), status })
      }
    }

    for (const occurrence of occurrences.filter((entry) => entry.cashierUserId === currentUserId)) {
      const assignment = assignmentById.get(occurrence.assignmentId)
      if (!assignment) continue
      const key = `${occurrence.assignmentId}:${occurrence.scheduledStartAt}`
      if (rows.has(key)) continue
      rows.set(key, {
        key,
        assignment,
        scheduledStartAt: occurrence.scheduledStartAt,
        scheduledEndAt: occurrence.scheduledEndAt,
        status: now >= new Date(occurrence.scheduledEndAt) ? 'completed' : 'active',
      })
    }

    const priority: Record<ShiftDisplayStatus, number> = { active: 0, available: 1, upcoming: 2, completed: 3, unavailable: 4 }
    return [...rows.values()]
      .filter((row) => isDateInDateRange(row.scheduledStartAt, dateRange, customDates))
      .sort((left, right) => priority[left.status] - priority[right.status]
        || new Date(left.scheduledStartAt).getTime() - new Date(right.scheduledStartAt).getTime())
  }, [currentUserId, customDates, dateRange, myAssignments, occurrences])

  const assignmentStartKey = timeKey(assignmentStartTime)
  const assignmentEndKey = timeKey(assignmentEndTime)
  const assignmentSummary = useMemo(() => {
    if (!selectedCashier || !assignmentStartTime || !assignmentEndTime || workingDays.length === 0) return null
    const values = {
      cashier: selectedCashier.name || selectedCashier.email,
      startTime: formatScheduleTime(assignmentStartTime),
      endTime: formatScheduleTime(assignmentEndTime),
      days: workingDayList(workingDays),
    }
    return isOvernight(assignmentStartKey, assignmentEndKey)
      ? t('paymentAccounts.shiftScheduleOvernightSummary', values)
      : t('paymentAccounts.shiftScheduleSummary', values)
  }, [assignmentEndKey, assignmentEndTime, assignmentStartKey, assignmentStartTime, selectedCashier, t, workingDays])

  const openTemplateDialog = () => {
    setTemplateName('')
    setTemplateStartTime(new Date(DEFAULT_TIME_DATE))
    setTemplateEndTime(new Date(DEFAULT_END_TIME_DATE))
    setTemplateDialogOpen(true)
  }

  const openAssignmentDialog = () => {
    setCashDrawer(null)
    setCashierUserId('')
    setSelectedTemplateId('__custom__')
    setAssignmentStartTime(new Date(DEFAULT_TIME_DATE))
    setAssignmentEndTime(new Date(DEFAULT_END_TIME_DATE))
    setWorkingDays([0, 1, 2, 3, 4])
    setAssignmentDialogOpen(true)
  }

  const selectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId)
    const template = templates.find((entry) => entry.id === templateId)
    if (!template) return
    const [startHours, startMinutes] = template.startTime.split(':').map(Number)
    const [endHours, endMinutes] = template.endTime.split(':').map(Number)
    setAssignmentStartTime(new Date(2000, 0, 1, startHours, startMinutes))
    setAssignmentEndTime(new Date(2000, 0, 1, endHours, endMinutes))
  }

  const toggleWorkingDay = (day: number, isWorking: boolean) => {
    setWorkingDays((current) => {
      const next = new Set(current)
      if (isWorking) next.add(day)
      else next.delete(day)
      return [...next].sort((left, right) => left - right)
    })
  }

  const saveTemplate = async () => {
    if (!workspaceId || !templateStartTime || !templateEndTime || !templateName.trim()) return
    setSavingTemplate(true)
    try {
      await createCashierShiftTemplate(workspaceId, { name: templateName, startTime: timeKey(templateStartTime), endTime: timeKey(templateEndTime) })
      toast({ title: t('paymentAccounts.shiftCreated') })
      setTemplateDialogOpen(false)
    } catch (error: any) {
      toast({ title: t('common.error'), description: error?.message, variant: 'destructive' })
    } finally {
      setSavingTemplate(false)
    }
  }

  const saveAssignment = async () => {
    if (!workspaceId || !cashDrawer || !selectedCashier || !assignmentStartTime || !assignmentEndTime || workingDays.length === 0) return
    setSavingAssignment(true)
    try {
      await createCashierShiftAssignment(workspaceId, {
        account: cashDrawer,
        cashierUserId: selectedCashier.id,
        cashierName: selectedCashier.name || selectedCashier.email,
        template: selectedTemplate,
        startTime: timeKey(assignmentStartTime),
        endTime: timeKey(assignmentEndTime),
        workingDays,
      })
      toast({ title: t('paymentAccounts.cashierShiftAssigned') })
      setAssignmentDialogOpen(false)
    } catch (error: any) {
      toast({ title: t('common.error'), description: error?.message, variant: 'destructive' })
    } finally {
      setSavingAssignment(false)
    }
  }

  const startShift = async () => {
    if (!workspaceId || !currentUserId || !startDialogRow) return
    setStartingShift(true)
    try {
      await startCashierShiftOccurrence(workspaceId, { assignmentId: startDialogRow.assignment.id, cashierUserId: currentUserId, scheduledStartAt: startDialogRow.scheduledStartAt })
      toast({ title: t('paymentAccounts.shiftStarted') })
      setStartDialogRow(null)
    } catch (error: any) {
      toast({ title: t('common.error'), description: error?.message, variant: 'destructive' })
    } finally {
      setStartingShift(false)
    }
  }

  if (!workspaceId || !enabled) return null

  return (
    <div className="space-y-8 p-6">
      <div>
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><WalletCards className="h-3.5 w-3.5" />{t('paymentAccounts.title')}</div>
        <h1 className="text-3xl font-bold tracking-tight">{t('paymentAccounts.shiftManagement')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.shiftManagementDescription')}</p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'shifts' | 'assignments')} className="space-y-6">
        <TabsList className="grid h-auto min-h-12 w-full max-w-md grid-cols-2 rounded-2xl bg-secondary/50 p-1">
          <TabsTrigger value="shifts" className="gap-2 rounded-xl"><Clock3 className="h-4 w-4" />{t('paymentAccounts.shiftsTab')}</TabsTrigger>
          <TabsTrigger value="assignments" className="gap-2 rounded-xl"><UserRound className="h-4 w-4" />{t('paymentAccounts.assignShiftsTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="shifts" className="mt-0 space-y-6">
          <Card><CardHeader className="border-b border-border/60 pb-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>{t('paymentAccounts.myShifts')}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.myShiftsDescription')}</p></div><span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{t('paymentAccounts.shiftCount', { count: shiftRows.length })}</span></div></CardHeader>
            <CardContent className="pt-6"><DateRangeFilters /><div className="mt-6 overflow-x-auto rounded-2xl border border-border/60"><Table><TableHeader><TableRow><TableHead>{t('paymentAccounts.shift')}</TableHead><TableHead>{t('paymentAccounts.cashDrawer')}</TableHead><TableHead>{t('paymentAccounts.scheduledStart')}</TableHead><TableHead>{t('paymentAccounts.scheduledEnd')}</TableHead><TableHead>{t('common.status')}</TableHead><TableHead className="text-end">{t('common.actions')}</TableHead></TableRow></TableHeader><TableBody>
              {shiftRows.length === 0 ? <TableRow><TableCell colSpan={6} className="py-12 text-center"><CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">{t('paymentAccounts.noAssignedShifts')}</p><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.noAssignedShiftsDescription')}</p></TableCell></TableRow> : shiftRows.map((row) => <TableRow key={row.key}><TableCell className="font-medium">{row.assignment.templateNameSnapshot || t('paymentAccounts.customShift')}</TableCell><TableCell>{row.assignment.accountNameSnapshot}</TableCell><TableCell>{formatOccurrenceDateTime(row.scheduledStartAt)}</TableCell><TableCell>{formatOccurrenceDateTime(row.scheduledEndAt)}</TableCell><TableCell><span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(row.status)}`}>{t(`paymentAccounts.shiftStatuses.${row.status}`)}</span></TableCell><TableCell className="text-end">{row.status === 'available' ? <Button size="sm" onClick={() => setStartDialogRow(row)}><ShieldCheck className="mr-2 h-4 w-4" />{t('paymentAccounts.startShift')}</Button> : null}</TableCell></TableRow>)}
            </TableBody></Table></div></CardContent></Card>
        </TabsContent>

        <TabsContent value="assignments" className="mt-0 space-y-6">
          <div className="flex flex-wrap justify-end gap-3"><Button variant="outline" onClick={openTemplateDialog}><Plus className="mr-2 h-4 w-4" />{t('paymentAccounts.createShift')}</Button><Button onClick={openAssignmentDialog}><UserRound className="mr-2 h-4 w-4" />{t('paymentAccounts.assignCashierShift')}</Button></div>
          <Card><CardHeader className="border-b border-border/60 pb-5"><div><CardTitle>{t('paymentAccounts.shiftAssignments')}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.shiftAssignmentsDescription')}</p></div></CardHeader><CardContent className="pt-6"><div className="overflow-x-auto rounded-2xl border border-border/60"><Table><TableHeader><TableRow><TableHead>{t('paymentAccounts.cashier')}</TableHead><TableHead>{t('paymentAccounts.shift')}</TableHead><TableHead>{t('paymentAccounts.cashDrawer')}</TableHead><TableHead>{t('paymentAccounts.shiftTime')}</TableHead><TableHead>{t('paymentAccounts.workingDays')}</TableHead></TableRow></TableHeader><TableBody>
            {visibleAssignments.length === 0 ? <TableRow><TableCell colSpan={5} className="py-12 text-center"><UserRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-semibold">{t('paymentAccounts.noShiftAssignments')}</p><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.noShiftAssignmentsDescription')}</p></TableCell></TableRow> : visibleAssignments.map((assignment) => <TableRow key={assignment.id}><TableCell className="font-medium">{assignment.cashierNameSnapshot}{assignment.cashierUserId === currentUserId ? <span className="ml-2 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{t('paymentAccounts.you')}</span> : null}</TableCell><TableCell>{assignment.templateNameSnapshot || t('paymentAccounts.customShift')}</TableCell><TableCell>{assignment.accountNameSnapshot}</TableCell><TableCell>{assignment.startTime} — {assignment.endTime}{isOvernight(assignment.startTime, assignment.endTime) ? <span className="ml-2 text-xs text-muted-foreground">{t('paymentAccounts.overnight')}</span> : null}</TableCell><TableCell>{workingDayList(assignment.workingDays)}</TableCell></TableRow>)}
          </TableBody></Table></div></CardContent></Card>
        </TabsContent>
      </Tabs>

      <AppDialog open={templateDialogOpen} onOpenChange={(open) => !savingTemplate && setTemplateDialogOpen(open)}><AppDialogContent className="max-w-xl" showCloseButton={!savingTemplate} onPointerDownOutside={(event) => savingTemplate && event.preventDefault()} onEscapeKeyDown={(event) => savingTemplate && event.preventDefault()}><AppDialogHeader><AppDialogTitle>{t('paymentAccounts.createShift')}</AppDialogTitle><AppDialogDescription>{t('paymentAccounts.createShiftDescription')}</AppDialogDescription></AppDialogHeader><AppDialogBody><div className="grid gap-5"><div className="grid gap-2"><Label htmlFor="cashier-shift-template-name">{t('paymentAccounts.shiftName')}</Label><Input id="cashier-shift-template-name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} disabled={savingTemplate} /></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>{t('paymentAccounts.startTime')}</Label><DateTimePicker mode="time" date={templateStartTime} setDate={setTemplateStartTime} disabled={savingTemplate} placeholder={t('paymentAccounts.selectTime')} /></div><div className="grid gap-2"><Label>{t('paymentAccounts.endTime')}</Label><DateTimePicker mode="time" date={templateEndTime} setDate={setTemplateEndTime} disabled={savingTemplate} placeholder={t('paymentAccounts.selectTime')} /></div></div></div></AppDialogBody><AppDialogFooter><Button variant="outline" onClick={() => setTemplateDialogOpen(false)} disabled={savingTemplate}>{t('common.cancel')}</Button><Button onClick={saveTemplate} disabled={savingTemplate || !templateName.trim() || !templateStartTime || !templateEndTime || timeKey(templateStartTime) === timeKey(templateEndTime)}><Plus className="mr-2 h-4 w-4" />{t('paymentAccounts.createShift')}</Button></AppDialogFooter></AppDialogContent></AppDialog>

      <AppDialog open={assignmentDialogOpen} onOpenChange={(open) => !savingAssignment && setAssignmentDialogOpen(open)}><AppDialogContent className="max-w-3xl" showCloseButton={!savingAssignment} onPointerDownOutside={(event) => savingAssignment && event.preventDefault()} onEscapeKeyDown={(event) => savingAssignment && event.preventDefault()}><AppDialogHeader><AppDialogTitle>{t('paymentAccounts.assignCashierShift')}</AppDialogTitle><AppDialogDescription>{t('paymentAccounts.assignCashierShiftDescription')}</AppDialogDescription></AppDialogHeader><AppDialogBody><div className="grid gap-6">
        <section className="grid gap-4"><div><h3 className="font-semibold">{t('paymentAccounts.cashier')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.cashierAssignmentDescription')}</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="cashier-shift-member">{t('paymentAccounts.assignedWorkspaceMember')}</Label><Select value={cashierUserId} onValueChange={setCashierUserId} disabled={savingAssignment || workspaceMembers.length === 0}><SelectTrigger id="cashier-shift-member"><SelectValue placeholder={t('paymentAccounts.selectWorkspaceMember')} /></SelectTrigger><SelectContent>{workspaceMembers.map((member) => <SelectItem key={member.id} value={member.id}>{member.name || member.email}</SelectItem>)}</SelectContent></Select></div><PaymentAccountSelector workspaceId={workspaceId} value={cashDrawer?.id} onValueChange={setCashDrawer} cashDrawerOnly allowNoAccount={false} applyDefault={false} placeholder={t('paymentAccounts.selectCashDrawer')} disabled={savingAssignment} label={t('paymentAccounts.cashDrawer')} /></div></section>
        <section className="grid gap-4 border-t border-border/60 pt-6"><div><h3 className="font-semibold">{t('paymentAccounts.shiftTime')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.shiftTimeDescription')}</p></div><div className="grid gap-4 sm:grid-cols-3"><div className="grid gap-2"><Label>{t('paymentAccounts.shiftTemplate')}</Label><Select value={selectedTemplateId} onValueChange={selectTemplate} disabled={savingAssignment}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__custom__">{t('paymentAccounts.customShift')}</SelectItem>{activeTemplates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name} · {template.startTime} — {template.endTime}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label>{t('paymentAccounts.startTime')}</Label><DateTimePicker mode="time" date={assignmentStartTime} setDate={setAssignmentStartTime} disabled={savingAssignment} placeholder={t('paymentAccounts.selectTime')} /></div><div className="grid gap-2"><Label>{t('paymentAccounts.endTime')}</Label><DateTimePicker mode="time" date={assignmentEndTime} setDate={setAssignmentEndTime} disabled={savingAssignment} placeholder={t('paymentAccounts.selectTime')} /></div></div>{isOvernight(assignmentStartKey, assignmentEndKey) ? <p className="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-sm text-sky-700">{t('paymentAccounts.overnightShiftHint')}</p> : null}</section>
        <section className="grid gap-4 border-t border-border/60 pt-6"><div><h3 className="font-semibold">{t('paymentAccounts.workingDays')}</h3><p className="mt-1 text-sm text-muted-foreground">{t('paymentAccounts.workingDaysDescription')}</p></div><div className="overflow-hidden rounded-2xl border border-border/60"><Table><TableHeader><TableRow><TableHead>{t('paymentAccounts.weekday')}</TableHead><TableHead>{t('paymentAccounts.workingDay')}</TableHead><TableHead>{t('paymentAccounts.dayOff')}</TableHead></TableRow></TableHeader><TableBody>{WEEKDAYS.map((day) => { const isWorking = workingDays.includes(day); return <TableRow key={day}><TableCell className="font-medium">{weekdayLabel(day)}</TableCell><TableCell><Button type="button" variant={isWorking ? 'default' : 'ghost'} size="sm" className="min-w-28" onClick={() => toggleWorkingDay(day, true)} disabled={savingAssignment}><Check className="mr-2 h-4 w-4" />{t('paymentAccounts.workingDay')}</Button></TableCell><TableCell><Button type="button" variant={!isWorking ? 'secondary' : 'ghost'} size="sm" className="min-w-28" onClick={() => toggleWorkingDay(day, false)} disabled={savingAssignment}><X className="mr-2 h-4 w-4" />{t('paymentAccounts.dayOff')}</Button></TableCell></TableRow> })}</TableBody></Table></div></section>
        <section className="rounded-2xl border border-primary/20 bg-primary/5 p-4"><h3 className="font-semibold">{t('paymentAccounts.scheduleSummary')}</h3><p className="mt-2 text-sm text-muted-foreground">{assignmentSummary ?? t('paymentAccounts.scheduleSummaryPending')}</p></section>
      </div></AppDialogBody><AppDialogFooter><Button variant="outline" onClick={() => setAssignmentDialogOpen(false)} disabled={savingAssignment}>{t('common.cancel')}</Button><Button onClick={saveAssignment} disabled={savingAssignment || !cashDrawer || !selectedCashier || !assignmentStartTime || !assignmentEndTime || workingDays.length === 0 || assignmentStartKey === assignmentEndKey}><UserRound className="mr-2 h-4 w-4" />{t('paymentAccounts.assignCashierShift')}</Button></AppDialogFooter></AppDialogContent></AppDialog>

      <AppDialog open={Boolean(startDialogRow)} onOpenChange={(open) => !startingShift && !open && setStartDialogRow(null)}><AppDialogContent className="max-w-xl" showCloseButton={!startingShift} onPointerDownOutside={(event) => startingShift && event.preventDefault()} onEscapeKeyDown={(event) => startingShift && event.preventDefault()}><AppDialogHeader><AppDialogTitle>{t('paymentAccounts.startShift')}</AppDialogTitle><AppDialogDescription>{t('paymentAccounts.startShiftConfirmationDescription')}</AppDialogDescription></AppDialogHeader><AppDialogBody>{startDialogRow ? <div className="grid gap-4"><div className="rounded-2xl border border-border/60 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('paymentAccounts.yourShiftWillStart')}</p><p className="mt-2 font-semibold">{formatOccurrenceDateTime(startDialogRow.scheduledStartAt)}</p></div><div className="rounded-2xl border border-border/60 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('paymentAccounts.yourShiftWillEnd')}</p><p className="mt-2 font-semibold">{formatOccurrenceDateTime(startDialogRow.scheduledEndAt)}</p></div></div> : null}</AppDialogBody><AppDialogFooter><Button variant="outline" onClick={() => setStartDialogRow(null)} disabled={startingShift}>{t('common.cancel')}</Button><PressAndHoldButton onComplete={startShift} idleLabel={t('paymentAccounts.holdToStartShift')} holdingLabel={t('paymentAccounts.keepHoldingToStartShift')} loadingLabel={t('paymentAccounts.startingShift')} isLoading={startingShift} icon={<ShieldCheck className="h-4 w-4" />} /></AppDialogFooter></AppDialogContent></AppDialog>
    </div>
  )
}
