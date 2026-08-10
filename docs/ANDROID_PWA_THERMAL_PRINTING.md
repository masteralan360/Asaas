# Android PWA thermal printing

Atlas can print POS receipts directly from an Android PWA without a desktop
agent when the browser can access the printer hardware.

## USB (recommended)

1. Open Atlas in **Chrome on Android** and install it as a PWA if desired.
2. Connect the powered thermal printer with a USB-OTG adapter.
3. Open **Settings → Printing → Thermal Printing**.
4. Choose **Pair USB Printer** in the Android direct printer pairing section.
5. Select the device in Chrome's USB chooser, choose its roll width, then
   select **Enable**.
6. Use **Print Test Receipt** before completing a sale.

The browser stores permission and the selected printer only on that device and
for that workspace. A disconnected device or revoked Android/Chrome permission
must be paired again.

The printer must expose a writable USB bulk or interrupt endpoint and accept
ESC/POS commands. Android or Chrome may prevent access to a device claimed by a
system driver; use the browser print fallback in that case.

## Bluetooth LE (optional)

Atlas supports Bluetooth **LE/GATT** printers, not Bluetooth Classic/SPP
printers. Before pairing, obtain both values from the printer manufacturer's
documentation:

- BLE service UUID
- Writable characteristic UUID

Enter them in Settings, choose **Pair Bluetooth LE Printer**, select the
printer in the browser chooser, then enable and test it. The PWA reconnects to
an already-authorized device for each checkout print.

## Receipt fidelity

Checkout first generates the selected primary sales-receipt template, including
custom layouts, RTL text, QR codes, and logos. Atlas rasterizes that receipt to
ESC/POS bytes, then sends it to the paired USB or BLE device, feeds three
lines, and requests a full cut.

## Limits

- Android Chrome and a secure HTTPS deployment are required for direct browser
  hardware access.
- Bluetooth Classic/SPP printers and iOS/iPadOS PWAs are not supported by the
  direct browser transport.
- For those devices, use the normal browser print flow or a dedicated native
  app/print bridge.
