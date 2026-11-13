"""Deterministic synthetic upload calibration PNG, not a customer/store photograph."""
from pathlib import Path
import struct
import zlib

width, height = 480, 640
pixels = bytearray()
for y in range(height):
    pixels.append(0)
    for x in range(width):
        tile = (x // 60 + y // 80) % 2
        pixels.extend((60 + tile * 100, 70 + y * 120 // height, 90 + x * 90 // width))

def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)

image = b'\x89PNG\r\n\x1a\n'
image += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
image += chunk(b'IDAT', zlib.compress(bytes(pixels), 9))
image += chunk(b'IEND', b'')
Path(__file__).with_name('synthetic-photo.png').write_bytes(image)
