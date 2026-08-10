import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    isDesktop: vi.fn(),
    isAndroidPwa: vi.fn(),
    listNativePrinters: vi.fn(),
    printNative: vi.fn(),
    testNative: vi.fn(),
    getAppSetting: vi.fn(),
    setAppSetting: vi.fn(),
    clearAppSetting: vi.fn(),
    qzIsActive: vi.fn(),
    qzConnect: vi.fn(),
    qzFindPrinters: vi.fn(),
    qzCreateConfig: vi.fn(),
    qzPrint: vi.fn()
}))

vi.mock('@/lib/platform', () => ({
    isDesktop: mocks.isDesktop,
    isAndroidPwa: mocks.isAndroidPwa
}))

vi.mock('@/i18n/config', () => ({
    default: {
        language: 'en',
        t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
    }
}))

vi.mock('@/local-db/settings', () => ({
    getAppSetting: mocks.getAppSetting,
    setAppSetting: mocks.setAppSetting,
    clearAppSetting: mocks.clearAppSetting
}))

vi.mock('tauri-plugin-thermal-printer', () => ({
    list_thermal_printers: mocks.listNativePrinters,
    print_thermal_printer: mocks.printNative,
    test_thermal_printer: mocks.testNative
}))

vi.mock('qz-tray', () => ({
    default: {
        websocket: {
            isActive: mocks.qzIsActive,
            connect: mocks.qzConnect
        },
        printers: {
            find: mocks.qzFindPrinters
        },
        configs: {
            create: mocks.qzCreateConfig
        },
        print: mocks.qzPrint
    }
}))

import { printService } from './printService'

describe('PWA thermal printing through QZ Tray', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.isDesktop.mockReturnValue(false)
        mocks.isAndroidPwa.mockReturnValue(false)
        mocks.qzIsActive.mockReturnValue(false)
        mocks.qzConnect.mockResolvedValue(undefined)
        mocks.qzCreateConfig.mockReturnValue({ printer: 'EPSON TM-T20' })
        mocks.qzPrint.mockResolvedValue(undefined)
    })

    it('discovers local PWA printers through QZ Tray', async () => {
        mocks.qzFindPrinters.mockResolvedValue(['EPSON TM-T20', 'Microsoft Print to PDF'])

        await expect(printService.listThermalPrinters()).resolves.toEqual([
            {
                name: 'EPSON TM-T20',
                identifier: 'EPSON TM-T20',
                interface_type: 'QZ Tray (local bridge)',
                status: 'Available',
                transport: 'qz'
            },
            {
                name: 'Microsoft Print to PDF',
                identifier: 'Microsoft Print to PDF',
                interface_type: 'QZ Tray (local bridge)',
                status: 'Available',
                transport: 'qz'
            }
        ])

        expect(mocks.qzConnect).toHaveBeenCalledWith({ retries: 0, delay: 0 })
    })

    it('sends the receipt image as a raw ESC/POS QZ print job', async () => {
        mocks.getAppSetting.mockResolvedValue(JSON.stringify({
            name: 'EPSON TM-T20',
            interface_type: 'QZ Tray (local bridge)',
            identifier: 'EPSON TM-T20',
            paper_size: 'Mm80',
            roll_width_mm: 80,
            transport: 'qz'
        }))

        await expect(printService.silentPrintImage({
            workspaceId: 'workspace-1',
            imageBase64: 'data:image/png;base64,abc123',
            maxWidth: 576
        })).resolves.toBe(true)

        expect(mocks.qzCreateConfig).toHaveBeenCalledWith('EPSON TM-T20', { jobName: 'Atlas Receipt' })
        expect(mocks.qzPrint).toHaveBeenCalledWith(
            { printer: 'EPSON TM-T20' },
            expect.arrayContaining([
                expect.objectContaining({
                    type: 'raw',
                    format: 'image',
                    flavor: 'base64',
                    data: 'abc123',
                    options: expect.objectContaining({ language: 'ESCPOS', imageEncoding: 'gs_v_0' })
                }),
                '\x1DV\x00'
            ])
        )
    })
})
