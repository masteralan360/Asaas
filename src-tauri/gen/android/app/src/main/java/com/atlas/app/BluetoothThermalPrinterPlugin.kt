package com.atlas.app

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.os.Build
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.IOException
import java.util.UUID

private const val BLUETOOTH_CONNECT_ALIAS = "bluetoothConnect"
private val SERIAL_PORT_PROFILE_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

@InvokeArg
class BluetoothPrintArgs {
    lateinit var address: String
    lateinit var payload: List<Int>
}

@InvokeArg
class BluetoothTestArgs {
    lateinit var address: String
}

data class BluetoothPrinterInfo(
    val name: String,
    val interface_type: String,
    val identifier: String,
    val status: String,
)

/**
 * Native Android Bluetooth Classic/SPP receipt printing. Android owns the
 * pairing flow, while Atlas selects from its already-paired devices.
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.BLUETOOTH_CONNECT], alias = BLUETOOTH_CONNECT_ALIAS),
    ],
)
class BluetoothThermalPrinterPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun list_paired_printers(invoke: Invoke) {
        requestBluetoothAccess(invoke, "listPairedPrinters")
    }

    @Command
    fun print_receipt(invoke: Invoke) {
        requestBluetoothAccess(invoke, "printReceipt")
    }

    @Command
    fun test_printer(invoke: Invoke) {
        requestBluetoothAccess(invoke, "testPrinter")
    }

    @PermissionCallback
    fun listPairedPrinters(invoke: Invoke) {
        if (!hasBluetoothAccess()) {
            invoke.reject("Bluetooth permission was denied. Allow Nearby devices access in Android Settings, then try again.")
            return
        }

        Thread {
            try {
                invoke.resolveObject(pairedPrinters())
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Could not read paired Bluetooth printers.")
            }
        }.start()
    }

    @PermissionCallback
    fun printReceipt(invoke: Invoke) {
        if (!hasBluetoothAccess()) {
            invoke.reject("Bluetooth permission was denied. Allow Nearby devices access in Android Settings, then try again.")
            return
        }

        val args = try {
            invoke.parseArgs(BluetoothPrintArgs::class.java)
        } catch (_: Exception) {
            invoke.reject("The Bluetooth receipt data is invalid.")
            return
        }

        Thread {
            try {
                writeToPrinter(args.address, args.payload.map { it.toByte() }.toByteArray())
                invoke.resolve()
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Could not print the Bluetooth receipt.")
            }
        }.start()
    }

    @PermissionCallback
    fun testPrinter(invoke: Invoke) {
        if (!hasBluetoothAccess()) {
            invoke.reject("Bluetooth permission was denied. Allow Nearby devices access in Android Settings, then try again.")
            return
        }

        val args = try {
            invoke.parseArgs(BluetoothTestArgs::class.java)
        } catch (_: Exception) {
            invoke.reject("The selected Bluetooth printer is invalid.")
            return
        }

        Thread {
            try {
                writeToPrinter(
                    args.address,
                    "\u001B@\u001Ba\u0001ATLAS\nThermal printer connected\n\u001Ba\u0000Test receipt printed successfully.\n\n\n\u001DV\u0000".toByteArray(),
                )
                invoke.resolve()
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Could not print the Bluetooth test receipt.")
            }
        }.start()
    }

    private fun requestBluetoothAccess(invoke: Invoke, callbackName: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || hasBluetoothAccess()) {
            when (callbackName) {
                "listPairedPrinters" -> listPairedPrinters(invoke)
                "printReceipt" -> printReceipt(invoke)
                else -> testPrinter(invoke)
            }
            return
        }

        requestPermissionForAlias(BLUETOOTH_CONNECT_ALIAS, invoke, callbackName)
    }

    private fun hasBluetoothAccess(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || getPermissionState(BLUETOOTH_CONNECT_ALIAS) == PermissionState.GRANTED

    private fun bluetoothAdapter(): BluetoothAdapter {
        val manager = activity.getSystemService(BluetoothManager::class.java)
            ?: throw IllegalStateException("Bluetooth is not available on this Android device.")
        return manager.adapter ?: throw IllegalStateException("Bluetooth is not available on this Android device.")
    }

    private fun pairedPrinters(): List<BluetoothPrinterInfo> {
        val adapter = bluetoothAdapter()
        if (!adapter.isEnabled) {
            throw IllegalStateException("Turn on Bluetooth, pair the printer in Android Settings, then refresh this list.")
        }

        return adapter.bondedDevices
            .sortedBy { it.name ?: it.address }
            .map { device ->
                BluetoothPrinterInfo(
                    name = device.name ?: "Bluetooth printer",
                    interface_type = "Bluetooth Classic (Tauri Android)",
                    identifier = device.address,
                    status = if (device.bondState == BluetoothDevice.BOND_BONDED) "Paired" else "Unavailable",
                )
            }
    }

    private fun writeToPrinter(address: String, payload: ByteArray) {
        val adapter = bluetoothAdapter()
        if (!adapter.isEnabled) {
            throw IllegalStateException("Turn on Bluetooth, then try printing again.")
        }

        val device = adapter.bondedDevices.firstOrNull { it.address.equals(address, ignoreCase = true) }
            ?: throw IllegalStateException("This printer is no longer paired. Pair it in Android Settings, then select it again in Atlas.")

        val socket = connectToSerialPrinter(device)
        try {
            socket.outputStream.use { output ->
                output.write(payload)
                output.flush()
            }
        } finally {
            socket.closeQuietly()
        }
    }

    private fun connectToSerialPrinter(device: BluetoothDevice): BluetoothSocket {
        try {
            return device.createInsecureRfcommSocketToServiceRecord(SERIAL_PORT_PROFILE_UUID).also { it.connect() }
        } catch (insecureError: IOException) {
            return try {
                device.createRfcommSocketToServiceRecord(SERIAL_PORT_PROFILE_UUID).also { it.connect() }
            } catch (secureError: IOException) {
                throw IOException("Could not connect to ${device.name ?: "the Bluetooth printer"}. Ensure it is on and supports Bluetooth Classic SPP.", secureError)
            }
        }
    }

    private fun BluetoothSocket.closeQuietly() {
        try {
            close()
        } catch (_: IOException) {
            // The receipt has already been sent; a close failure is not actionable.
        }
    }
}
