#!/usr/bin/env python3
"""Send XTest input only to the named headless Minecraft instance."""
import argparse
import ctypes as C
import json
import os
from pathlib import Path
import re
import time


def instance_display(instance):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", instance):
        raise ValueError("Use the exact instance id (letters, numbers, underscore, hyphen)")
    matches = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            argv = proc.joinpath('cmdline').read_bytes().split(b'\0')
            if not Path(os.fsdecode(argv[0])).name.startswith('mcpelauncher-client'):
                continue
            index = argv.index(b'--agent-socket')
            if Path(os.fsdecode(argv[index + 1])).name != f'mcpelauncher-agent-{instance}.sock':
                continue
            env = dict(part.split(b'=', 1) for part in proc.joinpath('environ').read_bytes().split(b'\0') if b'=' in part)
            display = os.fsdecode(env.get(b'DISPLAY', b''))
            auth = Path(os.fsdecode(env.get(b'XAUTHORITY', b'')))
            # Require xvfb-run in this client's ancestry; never target the desktop.
            parent = proc
            headless = False
            for _ in range(32):
                args = parent.joinpath('cmdline').read_bytes().split(b'\0')
                if any(Path(os.fsdecode(a)).name == 'xvfb-run' for a in args if a):
                    headless = True
                    break
                status = parent.joinpath('status').read_text()
                ppid = int(re.search(r'^PPid:\s+(\d+)', status, re.M)[1])
                if ppid <= 1:
                    break
                parent = Path('/proc') / str(ppid)
            if not headless or not re.fullmatch(r':\d+(?:\.\d+)?', display) or not auth.is_absolute():
                continue
            host_auth = proc / 'root' / str(auth).lstrip('/')
            if host_auth.is_file():
                matches.append((int(proc.name), display, str(host_auth)))
        except (OSError, ValueError, IndexError):
            continue
    if len(matches) != 1:
        raise ValueError(f'Expected one live private-Xvfb client for {instance}; found {len(matches)}')
    return matches[0]


class Keyboard:
    def __init__(self, display, auth, delay_ms):
        os.environ['DISPLAY'] = display
        os.environ['XAUTHORITY'] = auth
        self.x = C.CDLL('libX11.so.6')
        self.xt = C.CDLL('libXtst.so.6')
        self.x.XOpenDisplay.argtypes = [C.c_char_p]
        self.x.XOpenDisplay.restype = C.c_void_p
        self.x.XCloseDisplay.argtypes = [C.c_void_p]
        self.x.XFlush.argtypes = [C.c_void_p]
        self.x.XStringToKeysym.argtypes = [C.c_char_p]
        self.x.XStringToKeysym.restype = C.c_ulong
        self.x.XKeysymToKeycode.argtypes = [C.c_void_p, C.c_ulong]
        self.x.XKeysymToKeycode.restype = C.c_uint
        self.x.XKeycodeToKeysym.argtypes = [C.c_void_p, C.c_uint, C.c_int]
        self.x.XKeycodeToKeysym.restype = C.c_ulong
        self.xt.XTestFakeKeyEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        self.d = self.x.XOpenDisplay(None)
        if not self.d:
            raise ValueError('Cannot open the instance private display')
        self.delay = delay_ms / 1000
        self.held = set()

    def focus_game(self):
        # MCP pointer events do not move the X pointer. Xvfb may still use
        # PointerRoot focus, or a launcher error dialog may own keyboard focus.
        self.x.XDefaultRootWindow.argtypes = [C.c_void_p]
        self.x.XDefaultRootWindow.restype = C.c_ulong
        self.x.XQueryTree.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(C.c_ulong),
                                     C.POINTER(C.c_ulong), C.POINTER(C.POINTER(C.c_ulong)), C.POINTER(C.c_uint)]
        self.x.XFetchName.argtypes = [C.c_void_p, C.c_ulong, C.POINTER(C.c_char_p)]
        self.x.XFree.argtypes = [C.c_void_p]
        self.x.XSetInputFocus.argtypes = [C.c_void_p, C.c_ulong, C.c_int, C.c_ulong]
        self.x.XRaiseWindow.argtypes = [C.c_void_p, C.c_ulong]
        root, parent, count = C.c_ulong(), C.c_ulong(), C.c_uint()
        children = C.POINTER(C.c_ulong)()
        if not self.x.XQueryTree(self.d, self.x.XDefaultRootWindow(self.d), C.byref(root),
                                C.byref(parent), C.byref(children), C.byref(count)):
            raise ValueError('Cannot inspect private display windows')
        matches = []
        try:
            for i in range(count.value):
                name = C.c_char_p()
                self.x.XFetchName(self.d, children[i], C.byref(name))
                if name:
                    if name.value == b'Minecraft':
                        matches.append(children[i])
                    self.x.XFree(name)
        finally:
            if children:
                self.x.XFree(children)
        if len(matches) != 1:
            raise ValueError(f'Expected one Minecraft window on private display; found {len(matches)}')
        self.window = matches[0]
        self.x.XRaiseWindow(self.d, self.window)
        self.x.XSetInputFocus(self.d, self.window, 2, 0)
        self.x.XFlush(self.d)

    def click(self, x, y):
        self.x.XTranslateCoordinates.argtypes = [C.c_void_p, C.c_ulong, C.c_ulong, C.c_int, C.c_int,
                                                C.POINTER(C.c_int), C.POINTER(C.c_int), C.POINTER(C.c_ulong)]
        self.xt.XTestFakeMotionEvent.argtypes = [C.c_void_p, C.c_int, C.c_int, C.c_int, C.c_ulong]
        self.xt.XTestFakeButtonEvent.argtypes = [C.c_void_p, C.c_uint, C.c_int, C.c_ulong]
        root_x, root_y, child = C.c_int(), C.c_int(), C.c_ulong()
        self.x.XTranslateCoordinates(self.d, self.window, self.x.XDefaultRootWindow(self.d),
                                     x, y, C.byref(root_x), C.byref(root_y), C.byref(child))
        self.xt.XTestFakeMotionEvent(self.d, -1, root_x.value, root_y.value, 0)
        self.x.XFlush(self.d)
        time.sleep(self.delay * 2)
        try:
            self.xt.XTestFakeButtonEvent(self.d, 1, 1, 0)
            self.x.XFlush(self.d)
            time.sleep(self.delay * 2)
        finally:
            self.xt.XTestFakeButtonEvent(self.d, 1, 0, 0)
            self.x.XFlush(self.d)
        time.sleep(self.delay * 2)

    def code(self, name):
        sym = ord(name) if len(name) == 1 else self.x.XStringToKeysym(name.encode('ascii'))
        code = self.x.XKeysymToKeycode(self.d, sym)
        if not sym or not code:
            raise ValueError(f'No X key mapping for {name!r}')
        base = self.x.XKeycodeToKeysym(self.d, code, 0)
        shifted = self.x.XKeycodeToKeysym(self.d, code, 1)
        if sym not in (base, shifted):
            raise ValueError(f'Unsupported keyboard group for {name!r}')
        return code, sym != base

    def event(self, code, down):
        self.xt.XTestFakeKeyEvent(self.d, code, int(down), 0)
        (self.held.add if down else self.held.discard)(code)
        self.x.XFlush(self.d)
        time.sleep(self.delay)

    def tap(self, name):
        code, shifted = self.code(name)
        shift = self.code('Shift_L')[0]
        if shifted:
            self.event(shift, True)
        self.event(code, True)
        self.event(code, False)
        if shifted:
            self.event(shift, False)

    def close(self):
        for code in list(self.held):
            self.event(code, False)
        self.x.XCloseDisplay(self.d)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instance', required=True)
    parser.add_argument('--text', default='', help='Printable ASCII; never submits automatically')
    parser.add_argument('--clear-chars', type=int, default=0,
                        help='End then this many BackSpaces; use the observed single-line text length')
    parser.add_argument('--keys', nargs='*', default=[], help='X key names after text, e.g. Home Delete period')
    parser.add_argument('--click', type=int, nargs=2, metavar=('X', 'Y'), help='Focus a field first, in full window pixels')
    parser.add_argument('--delay-ms', type=int, default=50, help='Per press/release, default suitable for 30 FPS')
    args = parser.parse_args()
    if not 10 <= args.delay_ms <= 1000:
        parser.error('--delay-ms must be 10..1000')
    if not 0 <= args.clear_chars <= 256:
        parser.error('--clear-chars must be 0..256')
    if any(not 32 <= ord(c) <= 126 for c in args.text):
        parser.error('--text supports printable ASCII only')
    pid, display, auth = instance_display(args.instance)
    keyboard = Keyboard(display, auth, args.delay_ms)
    start = time.monotonic()
    try:
        # Validate every requested key before changing the focused field.
        for name in list(args.text) + args.keys + ['Home', 'End', 'Shift_L', 'BackSpace']:
            keyboard.code(name)
        keyboard.focus_game()
        if args.click:
            keyboard.click(*args.click)
        if args.clear_chars:
            keyboard.tap('End')
            for _ in range(args.clear_chars):
                keyboard.tap('BackSpace')
        for character in args.text:
            keyboard.tap(character)
        for name in args.keys:
            keyboard.tap(name)
    finally:
        keyboard.close()
    print(json.dumps({'instance': args.instance, 'pid': pid, 'characters': len(args.text),
                      'elapsed_ms': round((time.monotonic() - start) * 1000)}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as exc:
        raise SystemExit(str(exc))
