# -*- coding: utf-8 -*-
"""Генератор иконок расширения (PNG) на чистом Python без зависимостей.

Стиль One UI: скруглённый квадрат-подложка с вертикальным градиентом синего,
белый лист заметки с трёмя строками текста. Никаких ассетов Samsung.
"""
import math
import struct
import sys
import os
import zlib

# Акцент One UI-подобного градиента
TOP = (30, 120, 240)    # верх
BOT = (20, 70, 180)     # низ
WHITE = (255, 255, 255)


def _clamp(v):
    return max(0, min(255, int(round(v))))


def rounded_sq_mask(size, radius):
    mask = [[0.0] * size for _ in range(size)]
    r = radius
    for y in range(size):
        for x in range(size):
            dx = max(r - x, x - (size - 1 - r), 0)
            dy = max(r - y, y - (size - 1 - r), 0)
            d = math.sqrt(dx * dx + dy * dy)
            mask[y][x] = 1.0 if d <= r else max(0.0, 1.0 - (d - r))
    return mask


def rounded_rect_mask(size, radius, l, t, w, h):
    mask = [[0.0] * size for _ in range(size)]
    for y in range(size):
        for x in range(size):
            if l <= x < l + w and t <= y < t + h:
                px, py = x - l, y - t
                dx = max(radius - px, px - (w - 1 - radius), 0)
                dy = max(radius - py, py - (h - 1 - radius), 0)
                d = math.sqrt(dx * dx + dy * dy)
                mask[y][x] = 1.0 if d <= radius else max(0.0, 1.0 - (d - radius))
    return mask


def gen_icon(size):
    radius = size * 0.26 if size >= 48 else size * 0.27
    sq = rounded_sq_mask(size, radius)
    m = size * 0.175
    sheet = rounded_rect_mask(size, radius * 0.55, m, m, size - 2 * m, size - 2 * m)
    # линии "текста" внутри листа
    lines = [[0.0] * size for _ in range(size)]
    lm = m + size * 0.115
    line_w = size - 2 * lm
    for li, frac in ((2, 0.62), (4, 0.80), (6, 0.62)):
        ly = size * (li + 1.6) / 10
        lh = max(1, int(round(size * 0.055)))
        lw = int(line_w * frac)
        for y in range(int(ly) - 1 if lh > 1 else int(ly), int(ly) + lh):
            if 0 <= y < size:
                for x in range(int(lm), int(lm + lw)):
                    if 0 <= x < size:
                        lines[y][x] = 1.0
    px = bytearray()
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            t = y / (size - 1)
            bg = tuple(TOP[i] + (BOT[i] - TOP[i]) * t for i in range(3))
            s = sheet[y][x]
            g = lines[y][x]
            rr, gg, bb = bg
            alpha = 255 * sq[y][x]
            if s > 0:
                rr = rr + (WHITE[0] - rr) * s
                gg = gg + (WHITE[1] - gg) * s
                bb = bb + (WHITE[2] - bb) * s
            if s > 0.7 and g > 0.5:
                rr, gg, bb = TOP
            row += bytes([_clamp(rr), _clamp(gg), _clamp(bb), _clamp(alpha)])
        px += row
    return _png(size, px)


def _png(size, raw):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def main(outdir):
    os.makedirs(outdir, exist_ok=True)
    for size in (16, 48, 128, 256):
        png = gen_icon(size)
        with open(os.path.join(outdir, f"icon{size}.png"), "wb") as f:
            f.write(png)
        print("icon%d.png %d bytes" % (size, len(png)))


if __name__ == "__main__":
    main(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                      "extension", "icons"))
