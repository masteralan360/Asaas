import { useState, useEffect } from 'react'
import patchNotesData from '../data/patch-notes.json'
import packageJson from '../../package.json'

export interface PatchHighlight {
    type: 'new' | 'improved' | 'fixed'
    title: string
    content: string
}

export interface PatchNote {
    date: string
    highlights: PatchHighlight[]
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
            const notes = (patchNotesData as any)[currentVersion]
            if (notes) {
                setCurrentPatch(notes)
                setVersion(currentVersion)
                setShowModal(true)
            }
        }

        // Add debug trigger to window
        // @ts-ignore
        window.showPatchNotes = (v?: string) => {
            const targetVersion = v || `v${packageJson.version}`
            const notes = (patchNotesData as any)[targetVersion]
            if (notes) {
                setCurrentPatch(notes)
                setVersion(targetVersion)
                setShowModal(true)
                return `Showing patch notes for ${targetVersion}`
            }
            return `No patch notes found for ${targetVersion}`
        }

        return () => {
            // @ts-ignore
            delete window.showPatchNotes
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
