import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'

interface EditableFieldProps {
    value: string | number
    onChange: (value: string) => void
    type?: 'text' | 'number' | 'date'
    className?: string
    display?: ((value: string) => ReactNode)
    placeholder?: string
    editable?: boolean
    inputClassName?: string
}

export function EditableField({
    value,
    onChange,
    type = 'text',
    className = '',
    display,
    placeholder = '',
    editable = true,
    inputClassName = '',
}: EditableFieldProps) {
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(String(value))
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        setDraft(String(value))
    }, [value])

    useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [editing])

    const handleStart = useCallback(() => {
        if (!editable) return
        setDraft(String(value))
        setEditing(true)
    }, [editable, value])

    const handleFinish = useCallback(() => {
        const trimmed = draft.trim()
        if (trimmed !== String(value)) {
            onChange(trimmed)
        }
        setEditing(false)
    }, [draft, onChange, value])

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleFinish()
        } else if (e.key === 'Escape') {
            setDraft(String(value))
            setEditing(false)
        }
    }, [handleFinish, value])

    const handleBlur = useCallback(() => {
        handleFinish()
    }, [handleFinish])

    if (!editing) {
        return (
            <span
                className={editable ? `cursor-pointer hover:bg-blue-50 rounded px-0.5 -mx-0.5 transition-colors ${className}` : className}
                onClick={handleStart}
                title={editable ? 'Click to edit' : undefined}
            >
                {display ? display(String(value)) : value || placeholder || <span className="text-gray-300 italic">empty</span>}
            </span>
        )
    }

    return (
        <input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className={`border border-blue-400 rounded px-1 py-0.5 text-sm bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-300 ${inputClassName || className}`}
            placeholder={placeholder}
        />
    )
}
