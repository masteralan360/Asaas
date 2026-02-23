import { useState, useEffect } from 'react'
import patchNotesData from '../data/patch-notes.json'
import packageJson from '../../package.json'

export interface PatchNote {
    date: string
    notes: string[]
}

export function usePatchNotes() {
    const [showModal, setShowModal] = useState(false)
    const [currentPatch, setCurrentPatch] = useState<PatchNote | null>(null)
    const [version, setVersion] = useState('')

    useEffect(() => {
        const currentVersion = `v${packageJson.version}`
        const lastSeenVersion = localStorage.getItem('last_seen_version')

        // If it's a new version and we have notes for it
        if (currentVersion !== lastSeenVersion) {
            const notes = (patchNotesData as Record<string, PatchNote>)[currentVersion]
            if (notes) {
                setCurrentPatch(notes)
                setVersion(currentVersion)
                setShowModal(true)
            }
        }
    }, [])

    const dismissModal = () => {
        const currentVersion = `v${packageJson.version}`
        localStorage.setItem('last_seen_version', currentVersion)
        setShowModal(false)
    }

    return {
        showModal,
        currentPatch,
        version,
        dismissModal
    }
}
