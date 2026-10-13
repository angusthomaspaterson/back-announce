#!/usr/bin/env python3
"""Draw the Back Announce icon as PNGs with the standard library only.

Same picture as web/icons/icon.svg: an orange rounded square, a record with grooves and
a speech-bubble tail. Writes icon-192.png, icon-512.png, icon-maskable-512.png and
apple-touch-icon.png (180) into web/icons/. Coverage is supersampled 4x4 per pixel.
"""
import math
import os
import struct
import sys
import zlib

ORANGE = (0xD3, 0x44, 0x1C)
CREAM = (0xFB, 0xFA, 0xF6)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "icons")


def inside_rounded(x, y, size, r):
    if x < 0 or y < 0 or x >= size or y >= size:
        return False
    cx = min(max(x, r), size - r)
    cy = min(max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def point_in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = sign((px, py), a, b), sign((px, py), b, c), sign((px, py), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def colour_at(u, v, maskable):
    """Colour of the design at point (u, v) in a 512 unit square, or None for transparent."""
    if not maskable and not inside_rounded(u, v, 512, 112):
        return None
    # The maskable version shrinks the artwork into the safe zone (inner 80 per cent).
    if maskable:
        u, v = (u - 256) / 0.8 + 256, (v - 256) / 0.8 + 256
    d = math.hypot(u - 256, v - 236)
    if d <= 30:
        return ORANGE
    if d <= 150:
        for ring in (104, 64):
            if abs(d - ring) <= 3:
                return (0xE6, 0x9E, 0x87)  # orange at 55 per cent over cream
        return CREAM
    if point_in_triangle(u, v, (150, 340), (128, 420), (214, 374)):
        return CREAM
    return ORANGE


def render(size, maskable=False, ss=4):
    rows = []
    scale = 512 / size
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    u = (px + (sx + 0.5) / ss) * scale
                    v = (py + (sy + 0.5) / ss) * scale
                    c = colour_at(u, v, maskable)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 255
            n = ss * ss
            if a:
                cov = a / n
                row += bytes((round(r / (a / 255)), round(g / (a / 255)), round(b / (a / 255)), round(cov)))
            else:
                row += b"\0\0\0\0"
        rows.append(b"\0" + bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, size, maskable in (("icon-192.png", 192, False), ("icon-512.png", 512, False),
                                 ("icon-maskable-512.png", 512, True), ("apple-touch-icon.png", 180, True)):
        path = os.path.join(OUT, name)
        with open(path, "wb") as f:
            f.write(png(size, render(size, maskable)))
        print(f"wrote {name} ({os.path.getsize(path)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
