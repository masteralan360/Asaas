import { useState, useMemo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAuth } from '@/auth'
import { db } from '@/local-db/database'
import { createClinicalAppointment, createClinicalPatient, searchClinicalPatients, useClinicalAppointments, useClinicalAppointment, updateClinicalAppointment } from '@/local-db/clinicalAppointments'
import type { ClinicalAppointment, ClinicalAppointmentStatus, ClinicalAppointmentType, ClinicalAppointmentPriority, ClinicalConfirmationMethod } from '@/local-db/clinicalAppointments'
import { useClinicalPresetsByCategory } from '@/local-db/clinicalPresets'
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, Label, Badge, Card, CardContent, CardHeader, CardTitle, DateTimePicker } from '@/ui/components'
import { Plus, Search, Upload, Trash2, FileText, ArrowLeft, CalendarClock, Edit } from 'lucide-react'
import { generateId, formatNumberWithCommas, formatTime } from '@/lib/utils'
import { r2Service } from '@/services/r2Service'
import { platformService } from '@/services/platformService'
import { useLocation, useRoute } from 'wouter'
import { useWorkspace } from '@/workspace'

const CLINIC_ATTACHMENTS_PREFIX = 'clinic-attachments'

const STATUS_VARIANTS: Record<string, string> = {
  draft: 'secondary',
  scheduled: 'default',
  confirmed: 'default',
  arrived: 'outline',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'destructive',
  no_show: 'destructive',
}

export function ClinicalAppointments() {
  const { user } = useAuth()
  const [, navigate] = useLocation()
  const [createMatch] = useRoute('/clinical-appointments/new')
  const [editMatch, editParams] = useRoute('/clinical-appointments/:id/edit')
  const workspaceId = user?.workspaceId ?? ''
  const editAppointment = useClinicalAppointment(editMatch ? editParams?.id : undefined)

  if (!workspaceId) return null

  if (createMatch) {
    return (
      <CreateAppointmentForm
        workspaceId={workspaceId}
        onCancel={() => navigate('/clinical-appointments')}
        onSaved={() => navigate('/clinical-appointments')}
      />
    )
  }

  if (editMatch && editAppointment) {
    return (
      <CreateAppointmentForm
        workspaceId={workspaceId}
        appointment={editAppointment}
        onCancel={() => navigate('/clinical-appointments')}
        onSaved={() => navigate('/clinical-appointments')}
      />
    )
  }

  if (editMatch && !editAppointment) return null

  return <AppointmentList workspaceId={workspaceId} navigate={navigate} />
}

function AppointmentList({ workspaceId, navigate }: { workspaceId: string; navigate: (path: string) => void }) {
  const { t } = useTranslation()
  const appointments = useClinicalAppointments(workspaceId)
  const [searchQuery, setSearchQuery] = useState('')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const handleStatusChange = useCallback(async (id: string, newStatus: string) => {
    setUpdatingId(id)
    try {
      await updateClinicalAppointment(id, { status: newStatus as any }, workspaceId)
    } catch (e) {
      console.error('[ClinicalAppointments] Failed to update status:', e)
    } finally {
      setUpdatingId(null)
    }
  }, [workspaceId])

  const filtered = useMemo(() => {
    if (!appointments) return []
    if (!searchQuery.trim()) return appointments
    const q = searchQuery.toLowerCase()
    return appointments.filter((a) =>
      a.patientName.toLowerCase().includes(q) ||
      (a.patientPhone && a.patientPhone.includes(q)) ||
      a.appointmentType.toLowerCase().includes(q)
    )
  }, [appointments, searchQuery])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t('clinicalAppointments.title', { defaultValue: 'Clinical Appointments Registry' })}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('clinicalAppointments.subtitle', { defaultValue: 'Manage patient appointments and scheduling' })}
          </p>
        </div>
        <Button onClick={() => navigate('/clinical-appointments/new')}>
          <Plus className="w-4 h-4 mr-2" />
          {t('clinicalAppointments.createButton', { defaultValue: 'Create Appointment' })}
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('clinicalAppointments.searchPlaceholder', { defaultValue: 'Search appointments...' })}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('clinicalAppointments.patient', { defaultValue: 'Patient' })}</TableHead>
              <TableHead>{t('clinicalAppointments.date', { defaultValue: 'Date' })}</TableHead>
              <TableHead>{t('clinicalAppointments.time', { defaultValue: 'Time' })}</TableHead>
              <TableHead>{t('clinicalAppointments.type', { defaultValue: 'Type' })}</TableHead>
              <TableHead>{t('clinicalAppointments.status', { defaultValue: 'Status' })}</TableHead>
              <TableHead>{t('clinicalAppointments.priority', { defaultValue: 'Priority' })}</TableHead>
              <TableHead>{t('clinicalAppointments.actions', { defaultValue: 'Actions' })}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                  {t('clinicalAppointments.noAppointments', { defaultValue: 'No appointments found' })}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((appt) => (
                <TableRow key={appt.id}>
                  <TableCell className="font-medium">{appt.patientName}</TableCell>
                  <TableCell>{appt.appointmentDate}</TableCell>
                  <TableCell>{formatTime(`${appt.appointmentDate}T${appt.startTime}`)}</TableCell>
                  <TableCell className="capitalize">{t('clinicalAppointments.types.' + appt.appointmentType, {defaultValue: appt.appointmentType.replace(/_/g, ' ')})}</TableCell>
                  <TableCell>
                    <Select
                      value={appt.status}
                      onValueChange={(v) => handleStatusChange(appt.id, v)}
                      disabled={updatingId === appt.id}
                    >
                      <SelectTrigger
                        className="h-7 w-[140px] border-0 p-0 shadow-none focus:ring-0"
                      >
                        <Badge variant={(STATUS_VARIANTS[appt.status] as any) ?? 'secondary'} className="pointer-events-none">
                          {t('clinicalAppointments.statuses.' + appt.status, {defaultValue: appt.status.replace(/_/g, ' ')})}
                        </Badge>
                      </SelectTrigger>
                      <SelectContent>
                        {['draft', 'scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'].map((s) => (
                          <SelectItem key={s} value={s}>
                            <Badge variant={(STATUS_VARIANTS[s] as any) ?? 'secondary'} className="pointer-events-none">
                              {t('clinicalAppointments.statuses.' + s, {defaultValue: s.replace(/_/g, ' ')})}
                            </Badge>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="capitalize">{t('clinicalAppointments.priorities.' + appt.priority, {defaultValue: appt.priority})}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => navigate(`/clinical-appointments/${appt.id}/edit`)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function CreateAppointmentForm({ workspaceId, appointment, onCancel, onSaved }: { workspaceId: string; appointment?: ClinicalAppointment; onCancel: () => void; onSaved: () => void }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { features } = useWorkspace()
  const isEditing = !!appointment

  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(appointment?.patientId ?? null)
  const [patientName, setPatientName] = useState(appointment?.patientName ?? '')
  const [patientPhone, setPatientPhone] = useState(appointment?.patientPhone ?? '')
  const [isNewPatient, setIsNewPatient] = useState<boolean>(appointment?.isNewPatient ?? true)
  const [showPatientCreate, setShowPatientCreate] = useState(false)
  const [newPatientName, setNewPatientName] = useState('')
  const [newPatientPhone, setNewPatientPhone] = useState('')

  const [appointmentDate, setAppointmentDate] = useState(appointment?.appointmentDate ?? '')
  const [startTime, setStartTime] = useState(appointment?.startTime ?? '')
  const [combinedDateTime, setCombinedDateTime] = useState<Date | undefined>(() => {
    if (appointment?.appointmentDate && appointment?.startTime) {
      const parts = appointment.appointmentDate.split('-').map(Number)
      const timeParts = appointment.startTime.split(':').map(Number)
      if (parts.length === 3 && timeParts.length >= 2) {
        return new Date(parts[0], parts[1] - 1, parts[2], timeParts[0], timeParts[1])
      }
    }
    return undefined
  })
  const handleDateTimeChange = useCallback((date: Date | undefined) => {
    setCombinedDateTime(date)
    if (date) {
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      setAppointmentDate(`${y}-${m}-${d}`)
      const hh = String(date.getHours()).padStart(2, '0')
      const mm = String(date.getMinutes()).padStart(2, '0')
      setStartTime(`${hh}:${mm}`)
    } else {
      setAppointmentDate('')
      setStartTime('')
    }
  }, [])
  const [appointmentType, setAppointmentType] = useState<ClinicalAppointmentType>(appointment?.appointmentType ?? 'consultation')
  const [reasonForVisit, setReasonForVisit] = useState(appointment?.reasonForVisit ?? '')
  const [showReasonSuggestions, setShowReasonSuggestions] = useState(false)
  const reasonForVisitPresets = useClinicalPresetsByCategory(workspaceId, 'reason_for_visit')
  const appointmentTypePresets = useClinicalPresetsByCategory(workspaceId, 'appointment_type')
  const [consultationFee, setConsultationFee] = useState(appointment?.consultationFee ?? 0)
  useEffect(() => {
    if (!appointmentTypePresets || appointment) return
    const preset = appointmentTypePresets.find((p) => p.name === appointmentType)
    if (preset?.consultationFee) setConsultationFee(preset.consultationFee)
  }, [appointmentTypePresets])
  const [estimatedPrice, setEstimatedPrice] = useState(appointment?.estimatedPrice ?? 0)
  const [status, setStatus] = useState<ClinicalAppointmentStatus>(appointment?.status ?? 'draft')
  const [confirmationMethod, setConfirmationMethod] = useState<ClinicalConfirmationMethod>(appointment?.confirmationMethod ?? 'phone')
  const [priority, setPriority] = useState<ClinicalAppointmentPriority>(appointment?.priority ?? 'normal')
  const [internalNotes, setInternalNotes] = useState(appointment?.internalNotes ?? '')
  const [attachments, setAttachments] = useState<File[]>([])

  const [saving, setSaving] = useState(false)

  const matchingPatients = useLiveQuery(async () => {
    if (!patientSearch.trim() || !workspaceId) return []
    return searchClinicalPatients(workspaceId, patientSearch)
  }, [patientSearch, workspaceId])

  const handlePatientSelect = useCallback(async (patientId: string) => {
    const patient = await db.clinical_patients.get(patientId)
    if (patient) {
      setSelectedPatientId(patientId)
      setPatientName(patient.name)
      setPatientPhone(patient.phone ?? '')
      setIsNewPatient(patient.isNewPatient)
      setShowPatientCreate(false)
      setPatientSearch('')
    }
  }, [])

  const handleCreateNewPatient = useCallback(async () => {
    if (!newPatientName.trim() || !workspaceId) return
    const patient = await createClinicalPatient(
      { name: newPatientName.trim(), phone: newPatientPhone.trim() || null, email: null, isNewPatient: true, notes: null, createdBy: user?.id ?? null } as any,
      workspaceId,
    )
    setSelectedPatientId(patient.id)
    setPatientName(patient.name)
    setPatientPhone(patient.phone ?? '')
    setIsNewPatient(true)
    setShowPatientCreate(false)
    setNewPatientName('')
    setNewPatientPhone('')
  }, [newPatientName, newPatientPhone, workspaceId, user])

  const handleFileAttach = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setAttachments((prev) => [...prev, ...files])
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!workspaceId || !patientName.trim() || !appointmentDate || !startTime) return
    setSaving(true)
    try {
      let apptId = isEditing ? appointment!.id : ''
      if (isEditing && appointment) {
        await updateClinicalAppointment(
          appointment.id,
          {
            patientName: patientName.trim(),
            patientPhone: patientPhone.trim() || null,
            isNewPatient,
            appointmentDate,
            startTime,
            appointmentType,
            reasonForVisit: reasonForVisit.trim() || null,
            consultationFee,
            estimatedPrice,
            status,
            confirmationMethod,
            priority,
            internalNotes: internalNotes.trim() || null,
          } as any,
          workspaceId,
        )
      } else {
        const created = await createClinicalAppointment(
          {
            patientId: selectedPatientId ?? generateId(),
            patientName: patientName.trim(),
            patientPhone: patientPhone.trim() || null,
            isNewPatient,
            appointmentDate,
            startTime,
            appointmentType,
            reasonForVisit: reasonForVisit.trim() || null,
            consultationFee,
            estimatedPrice,
            status,
            confirmationMethod,
            priority,
            internalNotes: internalNotes.trim() || null,
            createdBy: user?.id ?? null,
          } as any,
          workspaceId,
        )
        apptId = created.id
      }

      for (const file of attachments) {
        const fileName = `${apptId}/${file.name}`
        const r2Path = `${CLINIC_ATTACHMENTS_PREFIX}/${workspaceId}/${fileName}`
        const localPath = await platformService.joinPath(
          await platformService.getAppDataDir(),
          CLINIC_ATTACHMENTS_PREFIX,
          workspaceId,
          fileName,
        )
        if (r2Service.isConfigured()) {
          try {
            await r2Service.upload(r2Path.replace(/\\/g, '/'), file, file.type)
          } catch (e) {
            console.error('[ClinicalAppointments] R2 upload failed:', e)
          }
        }
        try {
          const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
          const buffer = await file.arrayBuffer()
          await writeTextFile(localPath, new Uint8Array(buffer) as any, { baseDir: BaseDirectory.AppData })
        } catch (e) {
          console.warn('[ClinicalAppointments] Local file save not available:', e)
        }
        const { createClinicalAttachment } = await import('@/local-db/clinicalAppointments')
        await createClinicalAttachment(
          {
            appointmentId: apptId,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
            r2Path: r2Path.replace(/\\/g, '/'),
            localPath,
            createdBy: user?.id ?? null,
          } as any,
          workspaceId,
        )
      }

      onSaved()
    } catch (e) {
      console.error('[ClinicalAppointments] Failed to save appointment:', e)
    } finally {
      setSaving(false)
    }
  }, [isEditing, appointment, workspaceId, patientName, patientPhone, selectedPatientId, isNewPatient, appointmentDate, startTime, appointmentType, reasonForVisit, consultationFee, estimatedPrice, status, confirmationMethod, priority, internalNotes, attachments, user, onSaved])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }} className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 custom-scrollbar">
          <div className="space-y-5 pb-5">
            <div className="space-y-1">
              <Button
                type="button"
                variant="ghost"
                className="h-auto gap-2 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={onCancel}
              >
                <ArrowLeft className="h-4 w-4" />
                {t('clinicalAppointments.title', { defaultValue: 'Clinical Appointments' })}
              </Button>
              <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
                <CalendarClock className="h-7 w-7" />
                {isEditing
                  ? t('clinicalAppointments.editTitle', { defaultValue: 'Edit Appointment' })
                  : t('clinicalAppointments.createTitle', { defaultValue: 'Create Appointment' })}
              </h1>
              <p className="text-sm text-muted-foreground">
                {isEditing
                  ? t('clinicalAppointments.editDescription', { defaultValue: 'Update the appointment details.' })
                  : t('clinicalAppointments.createDescription', { defaultValue: 'Fill in the details to schedule a new appointment.' })}
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('clinicalAppointments.patientSection', { defaultValue: 'Patient' })}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  {!showPatientCreate ? (
                    <div className="grid gap-2">
                      <Label>{t('clinicalAppointments.patient', { defaultValue: 'Patient' })}</Label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          placeholder={t('clinicalAppointments.searchPatient', { defaultValue: 'Search existing patient...' })}
                          value={patientSearch}
                          onChange={(e) => {
                            setPatientSearch(e.target.value)
                            if (!e.target.value) {
                              setSelectedPatientId(null)
                              setPatientName('')
                            }
                          }}
                          className="pl-10"
                        />
                      </div>
                      {patientSearch.trim() && matchingPatients && matchingPatients.length > 0 && (
                        <div className="border rounded-md max-h-40 overflow-y-auto">
                          {matchingPatients.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                              onClick={() => handlePatientSelect(p.id)}
                            >
                              <span className="font-medium">{p.name}</span>
                              {p.phone && <span className="text-muted-foreground ml-2">{p.phone}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                      {!selectedPatientId && (
                        <Button variant="outline" size="sm" type="button" onClick={() => setShowPatientCreate(true)}>
                          <Plus className="w-3 h-3 mr-1" />
                          {t('clinicalAppointments.createNewPatient', { defaultValue: 'Create new patient' })}
                        </Button>
                      )}
                      {selectedPatientId && (
                        <div className="flex items-center gap-2 text-sm p-2 bg-accent/50 rounded-md">
                          <span className="font-medium">{patientName}</span>
                          {patientPhone && <span className="text-muted-foreground">{patientPhone}</span>}
                          <button
                            type="button"
                            className="ml-auto text-muted-foreground hover:text-foreground"
                            onClick={() => { setSelectedPatientId(null); setPatientName(''); setPatientPhone(''); setPatientSearch('') }}
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3 p-4 border rounded-lg">
                      <div className="grid gap-2">
                        <Label>{t('clinicalAppointments.patientName', { defaultValue: 'Patient Name' })}</Label>
                        <Input value={newPatientName} onChange={(e) => setNewPatientName(e.target.value)} />
                      </div>
                      <div className="grid gap-2">
                        <Label>{t('clinicalAppointments.phone', { defaultValue: 'Phone' })}</Label>
                        <Input value={newPatientPhone} onChange={(e) => setNewPatientPhone(e.target.value)} />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" type="button" onClick={handleCreateNewPatient} disabled={!newPatientName.trim()}>
                          {t('clinicalAppointments.savePatient', { defaultValue: 'Save Patient' })}
                        </Button>
                        <Button size="sm" variant="ghost" type="button" onClick={() => setShowPatientCreate(false)}>
                          {t('common.cancel', { defaultValue: 'Cancel' })}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('clinicalAppointments.appointmentSection', { defaultValue: 'Appointment' })}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="grid gap-2">
                      <Label>{t('clinicalAppointments.dateTime', { defaultValue: 'Date & Time' })}</Label>
                      <DateTimePicker
                        id="clinical-appointment-datetime"
                        mode="date-time"
                        date={combinedDateTime}
                        setDate={handleDateTimeChange}
                        placeholder={t('clinicalAppointments.dateTime', { defaultValue: 'Select date and time' })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>{t('clinicalAppointments.appointmentType', { defaultValue: 'Appointment Type' })}</Label>
                      <Select value={appointmentType} onValueChange={(v: ClinicalAppointmentType) => { setAppointmentType(v); const atPreset = appointmentTypePresets?.find((p) => p.name === v); const rvPreset = reasonForVisit.trim() ? reasonForVisitPresets?.find((p) => p.name === reasonForVisit) : null; if (atPreset?.consultationFee && (!rvPreset || atPreset.sortOrder <= rvPreset.sortOrder)) setConsultationFee(atPreset.consultationFee) }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['consultation', 'follow_up', 'emergency', 'checkup', 'procedure', 'treatment'].map((type) => (
                            <SelectItem key={type} value={type}>
                              {t('clinicalAppointments.types.' + type, {defaultValue: type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())})}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2 relative">
                      <Label>{t('clinicalAppointments.reasonForVisit', { defaultValue: 'Reason for Visit' })}</Label>
                      <Input
                        value={reasonForVisit}
                        onChange={(e) => { setReasonForVisit(e.target.value); setShowReasonSuggestions(true) }}
                        onFocus={() => setShowReasonSuggestions(true)}
                        onBlur={() => setShowReasonSuggestions(false)}
                        placeholder={t('clinicalAppointments.reasonForVisitPlaceholder', {defaultValue: 'e.g. Tooth pain'})}
                      />
                      {showReasonSuggestions && reasonForVisit.trim() && reasonForVisitPresets && reasonForVisitPresets.length > 0 && (
                        <div className="absolute top-full mt-1 left-0 right-0 border rounded-md max-h-40 overflow-y-auto bg-background z-10 shadow-lg">
                          {reasonForVisitPresets
                            .filter((p) => p.name.toLowerCase().includes(reasonForVisit.toLowerCase()))
                            .map((preset) => (
                              <button
                                key={preset.id}
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setReasonForVisit(preset.name); const atPreset = appointmentTypePresets?.find((p) => p.name === appointmentType); if (preset.consultationFee && (!atPreset || preset.sortOrder < atPreset.sortOrder)) setConsultationFee(preset.consultationFee); setShowReasonSuggestions(false) }}
                              >
                                {preset.name}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('clinicalAppointments.pricingSection', { defaultValue: 'Pricing' })}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>{t('clinicalAppointments.consultationFee', { defaultValue: 'Consultation Fee' })}</Label>
                    <div className="relative">
                      <Input className="pr-12" value={consultationFee ? formatNumberWithCommas(consultationFee) : ''} onChange={(e) => setConsultationFee(Number(e.target.value.replace(/,/g, '')))} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{features.iqd_display_preference}</span>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('clinicalAppointments.estimatedPrice', { defaultValue: 'Estimated Price' })}</Label>
                    <div className="relative">
                      <Input className="pr-12" value={estimatedPrice ? formatNumberWithCommas(estimatedPrice) : ''} onChange={(e) => setEstimatedPrice(Number(e.target.value.replace(/,/g, '')))} />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">{features.iqd_display_preference}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('clinicalAppointments.statusSection', { defaultValue: 'Status' })}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label>{t('clinicalAppointments.status', { defaultValue: 'Status' })}</Label>
                      <Select value={status} onValueChange={(v: ClinicalAppointmentStatus) => setStatus(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['draft', 'scheduled', 'confirmed', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_show'].map((s) => (
                            <SelectItem key={s} value={s}>{t('clinicalAppointments.statuses.' + s, {defaultValue: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())})}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>{t('clinicalAppointments.confirmationMethod', { defaultValue: 'Method' })}</Label>
                      <Select value={confirmationMethod} onValueChange={(v: ClinicalConfirmationMethod) => setConfirmationMethod(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {['phone', 'sms', 'whatsapp', 'email', 'other'].map((m) => (
                            <SelectItem key={m} value={m}>{t('clinicalAppointments.confirmationMethods.' + m, {defaultValue: m.charAt(0).toUpperCase() + m.slice(1)})}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>{t('clinicalAppointments.priority', { defaultValue: 'Priority' })}</Label>
                      <Select value={priority} onValueChange={(v: ClinicalAppointmentPriority) => setPriority(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">{t('clinicalAppointments.priorities.normal', {defaultValue: 'Normal'})}</SelectItem>
                          <SelectItem value="urgent">{t('clinicalAppointments.priorities.urgent', {defaultValue: 'Urgent'})}</SelectItem>
                          <SelectItem value="emergency">{t('clinicalAppointments.priorities.emergency', {defaultValue: 'Emergency'})}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('clinicalAppointments.notesSection', { defaultValue: 'Notes' })}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>{t('clinicalAppointments.internalNotes', { defaultValue: 'Internal Notes' })}</Label>
                    <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} />
                  </div>
                  <div className="grid gap-2">
                    <Label>{t('clinicalAppointments.attachments', { defaultValue: 'Attachments' })}</Label>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" type="button" onClick={() => document.getElementById('file-upload')?.click()}>
                        <Upload className="w-4 h-4 mr-1" />
                        {t('clinicalAppointments.uploadFiles', { defaultValue: 'Upload Files' })}
                      </Button>
                      <input id="file-upload" type="file" multiple className="hidden" onChange={handleFileAttach} />
                    </div>
                    {attachments.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {attachments.map((file, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm p-2 bg-accent/50 rounded-md">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="flex-1 truncate">{file.name}</span>
                            <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
                            <button type="button" onClick={() => removeAttachment(i)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex-shrink-0 border-t bg-background/95 px-4 py-2 backdrop-blur lg:px-6">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onCancel} disabled={saving}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button type="submit" className="w-full sm:w-auto" disabled={saving || !patientName.trim() || !appointmentDate || !startTime}>
              {saving
                ? t('common.saving', { defaultValue: 'Saving...' })
                : isEditing
                  ? t('clinicalAppointments.saveChanges', { defaultValue: 'Save Changes' })
                  : t('clinicalAppointments.createAppointment', { defaultValue: 'Create Appointment' })}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
