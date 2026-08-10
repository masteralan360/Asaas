import { appendEscPosFeedAndCut, encodeEscPosRaster } from './escPosRaster'

export type DirectMobileThermalTransport = 'webusb' | 'webbluetooth'

export interface WebUsbThermalProfile {
    vendor_id: number
    product_id: number
    serial_number?: string
    configuration_value: number
    interface_number: number
    alternate_setting: number
    endpoint_number: number
}

export interface WebBluetoothThermalProfile {
    device_id: string
    service_uuid: string
    characteristic_uuid: string
}

export interface DirectMobileThermalPrinter {
    name: string
    interface_type: string
    identifier: string
    status: string
    transport: DirectMobileThermalTransport
    is_thermal: true
    usb?: WebUsbThermalProfile
    bluetooth?: WebBluetoothThermalProfile
}

interface BrowserUsbEndpoint {
    endpointNumber: number
    direction: 'in' | 'out'
    type: 'bulk' | 'control' | 'interrupt' | 'isochronous'
}

interface BrowserUsbAlternateInterface {
    alternateSetting: number
    endpoints: BrowserUsbEndpoint[]
}

interface BrowserUsbInterface {
    interfaceNumber: number
    alternate: BrowserUsbAlternateInterface
    alternates: BrowserUsbAlternateInterface[]
}

interface BrowserUsbConfiguration {
    configurationValue: number
    interfaces: BrowserUsbInterface[]
}

interface BrowserUsbDevice {
    vendorId: number
    productId: number
    serialNumber?: string
    productName?: string
    configuration?: BrowserUsbConfiguration
    configurations: BrowserUsbConfiguration[]
    open: () => Promise<void>
    close: () => Promise<void>
    selectConfiguration: (configurationValue: number) => Promise<void>
    claimInterface: (interfaceNumber: number) => Promise<void>
    releaseInterface: (interfaceNumber: number) => Promise<void>
    selectAlternateInterface: (interfaceNumber: number, alternateSetting: number) => Promise<void>
    transferOut: (endpointNumber: number, data: BufferSource) => Promise<{ status: 'ok' | 'stall' | 'babble' }>
}

interface BrowserUsb {
    getDevices: () => Promise<BrowserUsbDevice[]>
    requestDevice: (options: { filters: Array<Record<string, never>> }) => Promise<BrowserUsbDevice>
}

interface BrowserBluetoothCharacteristic {
    properties?: { write?: boolean; writeWithoutResponse?: boolean }
    writeValue?: (value: BufferSource) => Promise<void>
    writeValueWithResponse?: (value: BufferSource) => Promise<void>
    writeValueWithoutResponse?: (value: BufferSource) => Promise<void>
}

interface BrowserBluetoothService {
    getCharacteristic: (uuid: string) => Promise<BrowserBluetoothCharacteristic>
}

interface BrowserBluetoothGattServer {
    connected: boolean
    connect: () => Promise<BrowserBluetoothGattServer>
    disconnect: () => void
    getPrimaryService: (uuid: string) => Promise<BrowserBluetoothService>
}

interface BrowserBluetoothDevice {
    id: string
    name?: string
    gatt?: BrowserBluetoothGattServer
}

interface BrowserBluetooth {
    getDevices?: () => Promise<BrowserBluetoothDevice[]>
    requestDevice: (options: { acceptAllDevices: true; optionalServices: string[] }) => Promise<BrowserBluetoothDevice>
}

interface BrowserHardwareNavigator {
    usb?: BrowserUsb
    bluetooth?: BrowserBluetooth
}

const USB_TRANSFER_CHUNK_SIZE = 4096
const BLE_SAFE_CHUNK_SIZE = 20

function getHardwareNavigator(): BrowserHardwareNavigator {
    return navigator as unknown as BrowserHardwareNavigator
}

function toHex(value: number) {
    return value.toString(16).padStart(4, '0').toUpperCase()
}

function getUsb(): BrowserUsb {
    const usb = getHardwareNavigator().usb
    if (!usb) {
        throw new Error('USB receipt printing is not supported by this browser. Use Chrome on Android with an OTG adapter.')
    }
    return usb
}

function getBluetooth(): BrowserBluetooth {
    const bluetooth = getHardwareNavigator().bluetooth
    if (!bluetooth) {
        throw new Error('Bluetooth LE receipt printing is not supported by this browser.')
    }
    return bluetooth
}

function getUsbOutputProfile(device: BrowserUsbDevice): WebUsbThermalProfile {
    const candidates = device.configurations.flatMap((configuration) =>
        configuration.interfaces.flatMap((usbInterface) =>
            usbInterface.alternates.flatMap((alternate) =>
                alternate.endpoints
                    .filter((endpoint) => endpoint.direction === 'out' && (endpoint.type === 'bulk' || endpoint.type === 'interrupt'))
                    .map((endpoint) => ({ configuration, usbInterface, alternate, endpoint }))
            )
        )
    )
    const candidate = candidates.find(({ endpoint }) => endpoint.type === 'bulk') || candidates[0]

    if (!candidate) {
        throw new Error('This USB device has no writable bulk or interrupt endpoint for receipt printing.')
    }

    return {
        vendor_id: device.vendorId,
        product_id: device.productId,
        serial_number: device.serialNumber || undefined,
        configuration_value: candidate.configuration.configurationValue,
        interface_number: candidate.usbInterface.interfaceNumber,
        alternate_setting: candidate.alternate.alternateSetting,
        endpoint_number: candidate.endpoint.endpointNumber
    }
}

async function prepareUsbDevice(device: BrowserUsbDevice, profile: WebUsbThermalProfile) {
    await device.open()

    if (!device.configuration || device.configuration.configurationValue !== profile.configuration_value) {
        await device.selectConfiguration(profile.configuration_value)
    }

    const usbInterface = device.configuration?.interfaces.find(
        (item) => item.interfaceNumber === profile.interface_number
    )
    if (!usbInterface) {
        throw new Error('The saved USB printer interface is no longer available. Pair the printer again.')
    }

    if (usbInterface.alternate.alternateSetting !== profile.alternate_setting) {
        await device.selectAlternateInterface(profile.interface_number, profile.alternate_setting)
    }

    await device.claimInterface(profile.interface_number)
}

async function writeUsb(device: BrowserUsbDevice, profile: WebUsbThermalProfile, data: Uint8Array) {
    let claimed = false
    try {
        await prepareUsbDevice(device, profile)
        claimed = true

        for (let offset = 0; offset < data.length; offset += USB_TRANSFER_CHUNK_SIZE) {
            const result = await device.transferOut(
                profile.endpoint_number,
                data.slice(offset, offset + USB_TRANSFER_CHUNK_SIZE)
            )
            if (result.status !== 'ok') {
                throw new Error(`USB printer rejected the receipt data (${result.status}).`)
            }
        }
    } finally {
        if (claimed) await device.releaseInterface(profile.interface_number).catch(() => undefined)
        await device.close().catch(() => undefined)
    }
}

async function findAuthorizedUsbPrinter(profile: WebUsbThermalProfile): Promise<BrowserUsbDevice> {
    const devices = await getUsb().getDevices()
    const device = devices.find((item) => (
        item.vendorId === profile.vendor_id
        && item.productId === profile.product_id
        && (!profile.serial_number || profile.serial_number === item.serialNumber)
    ))
    if (!device) {
        throw new Error('USB printer is not connected or Android permission was lost. Pair it again from Settings.')
    }
    return device
}

async function getBluetoothCharacteristic(profile: WebBluetoothThermalProfile) {
    const bluetooth = getBluetooth()
    if (!bluetooth.getDevices) {
        throw new Error('This browser cannot reconnect to paired Bluetooth printers. Pair the printer again from Settings.')
    }

    const devices = await bluetooth.getDevices()
    const device = devices.find((item) => item.id === profile.device_id)
    if (!device?.gatt) {
        throw new Error('Bluetooth printer is unavailable. Ensure it is on and pair it again from Settings.')
    }

    const server = device.gatt.connected ? device.gatt : await device.gatt.connect()
    const service = await server.getPrimaryService(profile.service_uuid)
    const characteristic = await service.getCharacteristic(profile.characteristic_uuid)
    return { device, characteristic }
}

async function writeBleChunk(characteristic: BrowserBluetoothCharacteristic, chunk: Uint8Array) {
    if (characteristic.writeValueWithoutResponse) {
        return characteristic.writeValueWithoutResponse(chunk)
    }
    if (characteristic.writeValueWithResponse) {
        return characteristic.writeValueWithResponse(chunk)
    }
    if (characteristic.writeValue) {
        return characteristic.writeValue(chunk)
    }
    throw new Error('The selected Bluetooth characteristic is not writable.')
}

async function writeBluetooth(characteristic: BrowserBluetoothCharacteristic, data: Uint8Array) {
    // A 20-byte ATT payload works with the default BLE MTU and is slower than
    // larger writes, but avoids assuming a printer supports MTU negotiation.
    for (let offset = 0; offset < data.length; offset += BLE_SAFE_CHUNK_SIZE) {
        await writeBleChunk(characteristic, data.slice(offset, offset + BLE_SAFE_CHUNK_SIZE))
    }
}

function createTestReceiptBytes() {
    return new TextEncoder().encode('\x1B@\x1Ba\x01ATLAS\nThermal printer connected\n\x1Ba\x00Test receipt printed successfully.\n\n\n\x1DV\x00')
}

export function getDirectMobileThermalCapabilities() {
    const hardware = getHardwareNavigator()
    return {
        usb: Boolean(hardware.usb),
        bluetooth: Boolean(hardware.bluetooth)
    }
}

export async function requestUsbThermalPrinter(): Promise<DirectMobileThermalPrinter> {
    const device = await getUsb().requestDevice({ filters: [] })
    const profile = getUsbOutputProfile(device)
    const name = device.productName || `USB Printer ${toHex(device.vendorId)}:${toHex(device.productId)}`

    // Validate that Android can open and claim the endpoint before saving it.
    await writeUsb(device, profile, new Uint8Array([0x1b, 0x40]))

    return {
        name,
        identifier: `usb:${toHex(device.vendorId)}:${toHex(device.productId)}:${device.serialNumber || 'device'}`,
        interface_type: 'USB (Android PWA)',
        status: 'Paired',
        transport: 'webusb',
        is_thermal: true,
        usb: profile
    }
}

export async function requestBluetoothThermalPrinter(input: {
    serviceUuid: string
    characteristicUuid: string
}): Promise<DirectMobileThermalPrinter> {
    const serviceUuid = input.serviceUuid.trim()
    const characteristicUuid = input.characteristicUuid.trim()
    if (!serviceUuid || !characteristicUuid) {
        throw new Error('Enter the Bluetooth service UUID and write-characteristic UUID from the printer documentation.')
    }

    const device = await getBluetooth().requestDevice({
        acceptAllDevices: true,
        optionalServices: [serviceUuid]
    })
    if (!device.gatt) {
        throw new Error('The selected Bluetooth device does not expose a GATT connection.')
    }

    const server = await device.gatt.connect()
    try {
        const service = await server.getPrimaryService(serviceUuid)
        const characteristic = await service.getCharacteristic(characteristicUuid)
        if (!characteristic.writeValue && !characteristic.writeValueWithResponse && !characteristic.writeValueWithoutResponse) {
            throw new Error('The selected Bluetooth characteristic does not allow writing.')
        }
    } finally {
        device.gatt.disconnect()
    }

    return {
        name: device.name || 'Bluetooth Thermal Printer',
        identifier: `ble:${device.id}`,
        interface_type: 'Bluetooth LE (Android PWA)',
        status: 'Paired',
        transport: 'webbluetooth',
        is_thermal: true,
        bluetooth: {
            device_id: device.id,
            service_uuid: serviceUuid,
            characteristic_uuid: characteristicUuid
        }
    }
}

export async function listAuthorizedUsbThermalPrinters(): Promise<DirectMobileThermalPrinter[]> {
    const devices = await getUsb().getDevices()
    return devices.flatMap((device) => {
        try {
            const profile = getUsbOutputProfile(device)
            const name = device.productName || `USB Printer ${toHex(device.vendorId)}:${toHex(device.productId)}`
            return [{
                name,
                identifier: `usb:${toHex(device.vendorId)}:${toHex(device.productId)}:${device.serialNumber || 'device'}`,
                interface_type: 'USB (Android PWA)',
                status: 'Previously paired',
                transport: 'webusb' as const,
                is_thermal: true as const,
                usb: profile
            }]
        } catch {
            return []
        }
    })
}

export async function printToDirectMobileThermalPrinter(
    printer: DirectMobileThermalPrinter,
    payload: Uint8Array
) {
    if (printer.transport === 'webusb') {
        if (!printer.usb) throw new Error('The saved USB printer profile is incomplete. Pair the printer again.')
        await writeUsb(await findAuthorizedUsbPrinter(printer.usb), printer.usb, payload)
        return
    }

    if (!printer.bluetooth) throw new Error('The saved Bluetooth printer profile is incomplete. Pair the printer again.')
    const { device, characteristic } = await getBluetoothCharacteristic(printer.bluetooth)
    try {
        await writeBluetooth(characteristic, payload)
    } finally {
        device.gatt?.disconnect()
    }
}

export async function testDirectMobileThermalPrinter(printer: DirectMobileThermalPrinter) {
    await printToDirectMobileThermalPrinter(printer, createTestReceiptBytes())
}

export async function renderReceiptImageToEscPos(imageBase64: string, maxWidth: number): Promise<Uint8Array> {
    if (typeof document === 'undefined') {
        throw new Error('Receipt image conversion is only available in a browser.')
    }

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new Image()
        nextImage.onload = () => resolve(nextImage)
        nextImage.onerror = () => reject(new Error('Could not read the receipt image for thermal printing.'))
        nextImage.src = imageBase64
    })
    const sourceWidth = image.naturalWidth || image.width
    const sourceHeight = image.naturalHeight || image.height
    if (!sourceWidth || !sourceHeight) throw new Error('Receipt image has no printable size.')

    const width = Math.max(1, Math.min(maxWidth, sourceWidth))
    const height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Could not prepare the receipt image for printing.')

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const raster = encodeEscPosRaster(context.getImageData(0, 0, width, height).data, width, height)
    return appendEscPosFeedAndCut(raster)
}
