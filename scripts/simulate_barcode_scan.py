#!/usr/bin/env python3
"""
Simulate a USB HID barcode scanner by sending scanner-like keyboard events.

Usage:
  python scripts/simulate_barcode_scan.py 1234567890123
  python scripts/simulate_barcode_scan.py ABC-123 --terminator tab
  python scripts/simulate_barcode_scan.py 1234567890123 --terminator none --pause 6:500

Start the script, then focus the POS window/input before the countdown ends.
"""

from __future__ import annotations

import argparse
import ctypes
import sys
import time
from ctypes import wintypes


KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008
INPUT_KEYBOARD = 1

SHIFT_SCAN_CODE = 0x2A

CHAR_TO_SCANCODE: dict[str, tuple[int, bool]] = {
    "1": (0x02, False),
    "2": (0x03, False),
    "3": (0x04, False),
    "4": (0x05, False),
    "5": (0x06, False),
    "6": (0x07, False),
    "7": (0x08, False),
    "8": (0x09, False),
    "9": (0x0A, False),
    "0": (0x0B, False),
    "-": (0x0C, False),
    "=": (0x0D, False),
    "q": (0x10, False),
    "w": (0x11, False),
    "e": (0x12, False),
    "r": (0x13, False),
    "t": (0x14, False),
    "y": (0x15, False),
    "u": (0x16, False),
    "i": (0x17, False),
    "o": (0x18, False),
    "p": (0x19, False),
    "[": (0x1A, False),
    "]": (0x1B, False),
    "a": (0x1E, False),
    "s": (0x1F, False),
    "d": (0x20, False),
    "f": (0x21, False),
    "g": (0x22, False),
    "h": (0x23, False),
    "j": (0x24, False),
    "k": (0x25, False),
    "l": (0x26, False),
    ";": (0x27, False),
    "'": (0x28, False),
    "`": (0x29, False),
    "\\": (0x2B, False),
    "z": (0x2C, False),
    "x": (0x2D, False),
    "c": (0x2E, False),
    "v": (0x2F, False),
    "b": (0x30, False),
    "n": (0x31, False),
    "m": (0x32, False),
    ",": (0x33, False),
    ".": (0x34, False),
    "/": (0x35, False),
    " ": (0x39, False),
    "!": (0x02, True),
    "@": (0x03, True),
    "#": (0x04, True),
    "$": (0x05, True),
    "%": (0x06, True),
    "^": (0x07, True),
    "&": (0x08, True),
    "*": (0x09, True),
    "(": (0x0A, True),
    ")": (0x0B, True),
    "_": (0x0C, True),
    "+": (0x0D, True),
    "{": (0x1A, True),
    "}": (0x1B, True),
    ":": (0x27, True),
    '"': (0x28, True),
    "~": (0x29, True),
    "|": (0x2B, True),
    "<": (0x33, True),
    ">": (0x34, True),
    "?": (0x35, True),
}

TERMINATOR_SCANCODES = {
    "enter": 0x1C,
    "tab": 0x0F,
}


ULONG_PTR = wintypes.WPARAM


class MOUSEINPUT(ctypes.Structure):
    _fields_ = (
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    )


class KEYBDINPUT(ctypes.Structure):
    _fields_ = (
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    )


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = (
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    )


class INPUT_UNION(ctypes.Union):
    _fields_ = (
        ("mi", MOUSEINPUT),
        ("ki", KEYBDINPUT),
        ("hi", HARDWAREINPUT),
    )


class INPUT(ctypes.Structure):
    _fields_ = (
        ("type", wintypes.DWORD),
        ("union", INPUT_UNION),
    )


user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
user32.SendInput.restype = wintypes.UINT
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowTextLengthW.argtypes = (wintypes.HWND,)
user32.GetWindowTextLengthW.restype = ctypes.c_int
user32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
user32.GetWindowTextW.restype = ctypes.c_int


def foreground_window_title() -> str:
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return ""

    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""

    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def send_scan_code(scan_code: int, key_up: bool = False) -> None:
    flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if key_up else 0)
    event = INPUT(
        type=INPUT_KEYBOARD,
        union=INPUT_UNION(
            ki=KEYBDINPUT(
                wVk=0,
                wScan=scan_code,
                dwFlags=flags,
                time=0,
                dwExtraInfo=0,
            )
        ),
    )
    sent = user32.SendInput(1, ctypes.byref(event), ctypes.sizeof(event))
    if sent != 1:
        raise ctypes.WinError(ctypes.get_last_error())


def tap_scan_code(scan_code: int, hold_ms: float) -> None:
    send_scan_code(scan_code, key_up=False)
    time.sleep(hold_ms / 1000)
    send_scan_code(scan_code, key_up=True)


def tap_character(char: str, hold_ms: float) -> None:
    if char.isalpha():
        scan_code, shifted = CHAR_TO_SCANCODE[char.lower()]
        shifted = shifted or char.isupper()
    else:
        try:
            scan_code, shifted = CHAR_TO_SCANCODE[char]
        except KeyError as exc:
            raise ValueError(f"Unsupported character {char!r}. Use common ASCII barcode/SKU characters.") from exc

    if shifted:
        send_scan_code(SHIFT_SCAN_CODE, key_up=False)
    try:
        tap_scan_code(scan_code, hold_ms)
    finally:
        if shifted:
            send_scan_code(SHIFT_SCAN_CODE, key_up=True)


def parse_pause(value: str) -> tuple[int, float]:
    try:
        index_text, delay_text = value.split(":", 1)
        index = int(index_text)
        delay_ms = float(delay_text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Pause must be formatted like INDEX:MS, for example 6:500") from exc

    if index < 0:
        raise argparse.ArgumentTypeError("Pause index must be 0 or greater")
    if delay_ms < 0:
        raise argparse.ArgumentTypeError("Pause delay must be 0 or greater")

    return index, delay_ms


def countdown(seconds: float) -> None:
    if seconds <= 0:
        return

    whole_seconds = int(seconds)
    for remaining in range(whole_seconds, 0, -1):
        title = foreground_window_title()
        target = f" Focused window: {title}" if title else ""
        print(f"Scanning starts in {remaining}s.{target}", flush=True)
        time.sleep(1)

    remainder = seconds - whole_seconds
    if remainder > 0:
        time.sleep(remainder)


def scan_value(
    value: str,
    delay_ms: float,
    hold_ms: float,
    terminator: str,
    pauses: dict[int, float],
) -> None:
    if 0 in pauses:
        time.sleep(pauses[0] / 1000)

    for index, char in enumerate(value, start=1):
        tap_character(char, hold_ms)
        if delay_ms > 0:
            time.sleep(delay_ms / 1000)
        if index in pauses:
            time.sleep(pauses[index] / 1000)

    if terminator != "none":
        tap_scan_code(TERMINATOR_SCANCODES[terminator], hold_ms)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Send a barcode/SKU as scanner-like keyboard events to the focused window."
    )
    parser.add_argument("value", nargs="?", help="Barcode/SKU text to scan, for example 1234567890123")
    parser.add_argument(
        "--start-delay",
        type=float,
        default=5,
        help="Seconds to wait before scanning so you can focus POS. Default: 5",
    )
    parser.add_argument(
        "--delay-ms",
        type=float,
        default=20,
        help="Delay between characters. Default: 20",
    )
    parser.add_argument(
        "--hold-ms",
        type=float,
        default=5,
        help="How long each key is held down. Default: 5",
    )
    parser.add_argument(
        "--terminator",
        choices=("enter", "tab", "none"),
        default="enter",
        help="Scanner suffix key. Most scanners use Enter. Default: enter",
    )
    parser.add_argument(
        "--pause",
        action="append",
        type=parse_pause,
        default=[],
        metavar="INDEX:MS",
        help="Pause after INDEX characters for MS milliseconds. Can be repeated. Example: --pause 6:500",
    )
    parser.add_argument(
        "--repeat",
        type=int,
        default=1,
        help="Number of times to scan the same value. Default: 1",
    )
    parser.add_argument(
        "--repeat-delay-ms",
        type=float,
        default=1200,
        help="Delay between repeated scans. Default: 1200",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be sent without pressing keys.",
    )
    parser.add_argument(
        "--self-check",
        action="store_true",
        help="Validate Windows SendInput structure setup without pressing keys.",
    )
    return parser


def main() -> int:
    if sys.platform != "win32":
        print("This script uses Windows SendInput and must be run on Windows.", file=sys.stderr)
        return 2

    parser = build_parser()
    args = parser.parse_args()

    if args.self_check:
        print(f"INPUT size: {ctypes.sizeof(INPUT)} bytes")
        print(f"KEYBDINPUT size: {ctypes.sizeof(KEYBDINPUT)} bytes")
        print(f"Pointer size: {ctypes.sizeof(ctypes.c_void_p)} bytes")
        return 0

    if not args.value:
        parser.error("value is required unless --self-check is used")

    if args.repeat < 1:
        parser.error("--repeat must be at least 1")

    pauses = dict(args.pause)

    if args.dry_run:
        print(f"Value: {args.value}")
        print(f"Terminator: {args.terminator}")
        print(f"Delay: {args.delay_ms} ms between characters")
        print(f"Pauses: {pauses or 'none'}")
        print(f"Repeat: {args.repeat}")
        return 0

    print("Focus the POS window now. Keep the scanner toggle enabled if testing global POS scanning.")
    countdown(args.start_delay)

    for scan_number in range(1, args.repeat + 1):
        print(f"Sending scan {scan_number}/{args.repeat}: {args.value}", flush=True)
        scan_value(args.value, args.delay_ms, args.hold_ms, args.terminator, pauses)
        if scan_number < args.repeat and args.repeat_delay_ms > 0:
            time.sleep(args.repeat_delay_ms / 1000)

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
