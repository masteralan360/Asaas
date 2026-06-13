import 'fake-indexeddb/auto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { clearWorkspaceModeSnapshot, writeWorkspaceModeSnapshot } from '@/workspace/workspaceMode'

import { db } from './database'

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
let createBusinessPartner: typeof import('./businessPartners').createBusinessPartner
let mergeBusinessPartners: typeof import('./businessPartners').mergeBusinessPartners
let updateBusinessPartner: typeof import('./businessPartners').updateBusinessPartner

function installBrowserStorage() {
    const rows = new Map<string, string>()
    const storage = {
        get length() {
            return rows.size
        },
        getItem: (key: string) => rows.get(key) ?? null,
        setItem: (key: string, value: string) => rows.set(key, value),
        removeItem: (key: string) => rows.delete(key),
        clear: () => rows.clear(),
        key: (index: number) => Array.from(rows.keys())[index] ?? null
    }

    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: storage
    })
    Object.defineProperty(globalThis, 'sessionStorage', {
        configurable: true,
        value: storage
    })
    const browserTarget = {
        localStorage: storage,
        sessionStorage: storage,
        location: { origin: 'http://localhost', hash: '', pathname: '/' },
        addEventListener: () => undefined,
        removeEventListener: () => undefined
    }

    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: browserTarget
    })
    Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: {
            visibilityState: 'visible',
            dir: 'ltr',
            documentElement: { lang: 'en', dir: 'ltr' },
            addEventListener: () => undefined,
            removeEventListener: () => undefined
        }
    })
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { onLine: false }
    })
}

describe('business partner agent facets', () => {
    beforeAll(async () => {
        installBrowserStorage()
        const businessPartners = await import('./businessPartners')
        createBusinessPartner = businessPartners.createBusinessPartner
        mergeBusinessPartners = businessPartners.mergeBusinessPartners
        updateBusinessPartner = businessPartners.updateBusinessPartner
    })

    beforeEach(async () => {
        await db.delete()
        await db.open()
        writeWorkspaceModeSnapshot({ workspaceId: WORKSPACE_ID, dataMode: 'local' })
    })

    afterEach(async () => {
        clearWorkspaceModeSnapshot(WORKSPACE_ID)
    })

    afterAll(async () => {
        await db.delete()
    })

    it('rejects the Agent role without module access', async () => {
        await expect(createBusinessPartner(WORKSPACE_ID, {
            name: 'Unauthorized Agent',
            phone: '07500000999',
            defaultCurrency: 'iqd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                zone: 'Restricted District',
                agentType: 'field_agent',
                status: 'active'
            }
        })).rejects.toThrow('Agent roles require workspace Agents module access')
    })

    it('creates an agent facet linked to the business partner', async () => {
        const partner = await createBusinessPartner(WORKSPACE_ID, {
            name: 'North Route Agent',
            phone: '07500000000',
            defaultCurrency: 'iqd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                imageUrl: 'agents-images/workspace/agent.jpg',
                zone: 'North District',
                agentType: 'field_agent',
                linkedUserId: null,
                status: 'active'
            }
        }, { allowAgentRole: true })

        expect(partner.agentFacetId).toBeTruthy()
        const agent = await db.agents.get(partner.agentFacetId!)
        expect(agent).toMatchObject({
            businessPartnerId: partner.id,
            zone: 'North District',
            agentType: 'field_agent',
            status: 'active'
        })
    })

    it('rejects a driver without vehicle details before persisting the partner', async () => {
        await expect(createBusinessPartner(WORKSPACE_ID, {
            name: 'Driver Without Vehicle',
            phone: '07500000001',
            defaultCurrency: 'iqd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                zone: 'Central District',
                agentType: 'driver',
                status: 'active'
            }
        }, { allowAgentRole: true })).rejects.toThrow('Car model and plate number are required for drivers')

        expect(await db.business_partners.count()).toBe(0)
        expect(await db.agents.count()).toBe(0)
    })

    it('marks the agent facet inactive when the partner changes roles', async () => {
        const partner = await createBusinessPartner(WORKSPACE_ID, {
            name: 'Convertible Agent',
            phone: '07500000002',
            defaultCurrency: 'usd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                zone: 'West District',
                agentType: 'driver',
                carModel: 'Toyota Hilux',
                plateNumber: '12 A 3456',
                status: 'active'
            }
        }, { allowAgentRole: true })

        const activeAssignment = await db.fleet_vehicle_assignments
            .where('agentId')
            .equals(partner.agentFacetId!)
            .first()
        const vehicle = activeAssignment
            ? await db.fleet_vehicles.get(activeAssignment.vehicleId)
            : undefined
        expect(vehicle).toMatchObject({
            plateNumber: '12 A 3456',
            model: 'Toyota Hilux'
        })
        expect(activeAssignment?.status).toBe('active')

        await updateBusinessPartner(partner.id, { role: 'customer' }, { allowAgentRole: true })

        const agent = await db.agents.get(partner.agentFacetId!)
        expect(agent?.status).toBe('inactive')
        const endedAssignment = await db.fleet_vehicle_assignments.get(activeAssignment!.id)
        expect(endedAssignment?.status).toBe('ended')
        expect(endedAssignment?.endedAt).toBeTruthy()
    })

    it('prevents one workspace user from being linked to multiple agents', async () => {
        const linkedUserId = '00000000-0000-4000-8000-000000000099'
        await createBusinessPartner(WORKSPACE_ID, {
            name: 'First Linked Agent',
            phone: '07500000004',
            defaultCurrency: 'iqd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                zone: 'North District',
                agentType: 'field_agent',
                linkedUserId,
                status: 'active'
            }
        }, { allowAgentRole: true })

        await expect(createBusinessPartner(WORKSPACE_ID, {
            name: 'Second Linked Agent',
            phone: '07500000005',
            defaultCurrency: 'iqd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                zone: 'South District',
                agentType: 'field_agent',
                linkedUserId,
                status: 'active'
            }
        }, { allowAgentRole: true })).rejects.toThrow('Workspace user is already linked to another agent')

        expect(await db.business_partners.count()).toBe(1)
        expect(await db.agents.count()).toBe(1)
    })

    it('rejects reassigning an agent to a workspace user linked elsewhere', async () => {
        const linkedUserId = '00000000-0000-4000-8000-000000000098'
        await createBusinessPartner(WORKSPACE_ID, {
            name: 'Assigned Agent',
            phone: '07500000006',
            defaultCurrency: 'iqd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                zone: 'East District',
                agentType: 'field_agent',
                linkedUserId,
                status: 'active'
            }
        }, { allowAgentRole: true })
        const unassignedAgent = await createBusinessPartner(WORKSPACE_ID, {
            name: 'Unassigned Agent',
            phone: '07500000007',
            defaultCurrency: 'iqd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                zone: 'West District',
                agentType: 'field_agent',
                status: 'active'
            }
        }, { allowAgentRole: true })

        await expect(updateBusinessPartner(unassignedAgent.id, {
            name: 'Must Not Persist',
            agent: { linkedUserId }
        }, { allowAgentRole: true })).rejects.toThrow('Workspace user is already linked to another agent')

        const unchangedPartner = await db.business_partners.get(unassignedAgent.id)
        const unchangedAgent = await db.agents.get(unassignedAgent.agentFacetId!)
        expect(unchangedPartner?.name).toBe('Unassigned Agent')
        expect(unchangedAgent?.linkedUserId).toBeNull()
    })

    it('does not collapse agent and commercial roles during a merge', async () => {
        const agent = await createBusinessPartner(WORKSPACE_ID, {
            name: 'Shared Name',
            phone: '07500000003',
            defaultCurrency: 'usd',
            creditLimit: 0,
            role: 'agent',
            agent: {
                zone: 'South District',
                agentType: 'field_agent',
                status: 'active'
            }
        }, { allowAgentRole: true })
        const customer = await createBusinessPartner(WORKSPACE_ID, {
            name: 'Shared Name',
            phone: '07500000003',
            defaultCurrency: 'usd',
            creditLimit: 0,
            role: 'customer'
        })

        await expect(mergeBusinessPartners(agent.id, customer.id))
            .rejects.toThrow('Agents can only be merged with other agents')
    })
})
