import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    printToDirectMobileThermalPrinter,
    requestUsbThermalPrinter,
    type DirectMobileThermalPrinter
} from './mobileThermalPrinter'

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

function createUsbDevice() {
    return {
        vendorId: 0x1234,
        productId: 0xabcd,
        serialNumber: 'receipt-1',
        productName: 'USB Thermal Printer',
        configuration: undefined,
        configurations: [{
            configurationValue: 1,
            interfaces: [{
                interfaceNumber: 2,
                alternate: { alternateSetting: 0, endpoints: [{ endpointNumber: 3, direction: 'out', type: 'bulk' }] },
                alternates: [{ alternateSetting: 0, endpoints: [{ endpointNumber: 3, direction: 'out', type: 'bulk' }] }]
            }]
        }],
        open: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        selectConfiguration: vi.fn().mockImplementation(async function (this: any) {
            this.configuration = this.configurations[0]
        }),
        claimInterface: vi.fn().mockResolvedValue(undefined),
        releaseInterface: vi.fn().mockResolvedValue(undefined),
        selectAlternateInterface: vi.fn().mockResolvedValue(undefined),
        transferOut: vi.fn().mockResolvedValue({ status: 'ok' })
    }
}

describe('direct Android USB thermal printing', () => {
    let device: ReturnType<typeof createUsbDevice>

    beforeEach(() => {
        device = createUsbDevice()
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
                usb: {
                    requestDevice: vi.fn().mockResolvedValue(device),
                    getDevices: vi.fn().mockResolvedValue([device])
                }
            }
        })
    })

    afterEach(() => {
        if (originalNavigator) {
            Object.defineProperty(globalThis, 'navigator', originalNavigator)
        } else {
            Reflect.deleteProperty(globalThis, 'navigator')
        }
    })

    it('pairs a USB device only after it exposes a writable output endpoint', async () => {
        await expect(requestUsbThermalPrinter()).resolves.toMatchObject({
            transport: 'webusb',
            is_thermal: true,
            identifier: 'usb:1234:ABCD:receipt-1',
            usb: {
                configuration_value: 1,
                interface_number: 2,
                endpoint_number: 3
            }
        })

        expect(device.claimInterface).toHaveBeenCalledWith(2)
        expect(device.transferOut).toHaveBeenCalledWith(3, expect.any(Uint8Array))
    })

    it('writes a receipt to the saved USB profile in sequential transfers', async () => {
        const printer: DirectMobileThermalPrinter = {
            name: 'USB Thermal Printer',
            interface_type: 'USB (Android PWA)',
            identifier: 'usb:1234:ABCD:receipt-1',
            status: 'Paired',
            transport: 'webusb',
            is_thermal: true,
            usb: {
                vendor_id: 0x1234,
                product_id: 0xabcd,
                serial_number: 'receipt-1',
                configuration_value: 1,
                interface_number: 2,
                alternate_setting: 0,
                endpoint_number: 3
            }
        }

        await printToDirectMobileThermalPrinter(printer, new Uint8Array([1, 2, 3]))

        expect(device.transferOut).toHaveBeenCalledWith(3, new Uint8Array([1, 2, 3]))
        expect(device.releaseInterface).toHaveBeenCalledWith(2)
        expect(device.close).toHaveBeenCalled()
    })
})
