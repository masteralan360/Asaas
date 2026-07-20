import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let browserOnline = true
let windowTarget: EventTarget
let manager: import('./connectionManager').ConnectionManager

beforeEach(async () => {
    browserOnline = true
    windowTarget = new EventTarget()

    vi.stubGlobal('window', windowTarget)
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
    vi.stubGlobal('navigator', {
        get onLine() {
            return browserOnline
        }
    })

    vi.resetModules()
    const { ConnectionManager } = await import('./connectionManager')
    manager = new ConnectionManager()
    manager.init()
})

afterEach(() => {
    manager.destroy()
    vi.unstubAllGlobals()
})

describe('ConnectionManager offline entry', () => {
    it('keeps the app online and requests confirmation after an OS-level disconnect', () => {
        const events: string[] = []
        manager.subscribe((event) => events.push(event))

        browserOnline = false
        windowTarget.dispatchEvent(new Event('offline'))

        expect(manager.getState()).toMatchObject({
            isOnline: true,
            isOsOnline: false,
            offlineConfirmationRequired: true
        })
        expect(events).toEqual(['network-lost'])

        expect(manager.continueOffline()).toBe(true)
        expect(manager.getState()).toMatchObject({
            isOnline: false,
            offlineConfirmationRequired: false
        })
        expect(events).toEqual(['network-lost', 'offline'])
    })

    it('does not produce duplicate prompts or offline transitions for repeated offline events', () => {
        const events: string[] = []
        manager.subscribe((event) => events.push(event))

        browserOnline = false
        windowTarget.dispatchEvent(new Event('offline'))
        windowTarget.dispatchEvent(new Event('offline'))

        expect(manager.continueOffline()).toBe(true)
        expect(manager.continueOffline()).toBe(false)
        windowTarget.dispatchEvent(new Event('offline'))

        expect(events).toEqual(['network-lost', 'offline'])
    })

    it('automatically restores online mode when the OS reports connectivity restored', () => {
        const events: string[] = []
        manager.subscribe((event) => events.push(event))

        browserOnline = false
        windowTarget.dispatchEvent(new Event('offline'))
        manager.continueOffline()

        browserOnline = true
        windowTarget.dispatchEvent(new Event('online'))

        expect(manager.getState()).toMatchObject({
            isOnline: true,
            isOsOnline: true,
            offlineConfirmationRequired: false
        })
        expect(events).toEqual(['network-lost', 'offline', 'online'])
    })

    it('does not change app connectivity when a Supabase request fails', () => {
        const events: string[] = []
        manager.subscribe((event) => events.push(event))

        manager.reportConnectivityFailure('products.fetch')

        expect(manager.getState()).toMatchObject({
            isOnline: true,
            isOsOnline: true,
            offlineConfirmationRequired: false
        })
        expect(events).toEqual([])
    })
})
