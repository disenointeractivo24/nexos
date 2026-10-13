"""
Lighter GLB models for phones: the PNG textures inside a .glb become JPEG.

Only the pictures change. Geometry, materials and everything else in the file stay byte
for byte as they were: the file is rewritten directly, not imported and exported again.
A PNG that really uses transparency (any pixel not fully opaque) is left as it is, and so
is any picture that would not get smaller.

Uso, desde starter/:
  blender -b --factory-startup --python tools/optimizar_glb.py -- static/assets/houses/casa-teja.glb [más .glb…]
"""
import bpy
import json
import os
import struct
import sys
import tempfile

import numpy as np

QUALITY = 88


def read_glb(path):
    data = open(path, 'rb').read()
    magic, version, length = struct.unpack_from('<4sII', data, 0)
    assert magic == b'glTF', f'{path} no es un GLB'
    off, gltf, binary = 12, None, b''
    while off < length:
        size, kind = struct.unpack_from('<I4s', data, off)
        chunk = data[off + 8: off + 8 + size]
        if kind == b'JSON':
            gltf = json.loads(chunk)
        elif kind == b'BIN\x00':
            binary = chunk
        off += 8 + size
    return gltf, binary


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(',', ':')).encode('utf8')
    js += b' ' * (-len(js) % 4)
    binary += b'\x00' * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    with open(path, 'wb') as f:
        f.write(struct.pack('<4sII', b'glTF', 2, total))
        f.write(struct.pack('<I4s', len(js), b'JSON') + js)
        f.write(struct.pack('<I4s', len(binary), b'BIN\x00') + binary)


def to_jpeg(png, tmp):
    """JPEG bytes for a PNG, or None if it has transparency."""
    src = os.path.join(tmp, 'in.png')
    dst = os.path.join(tmp, 'out.jpg')
    open(src, 'wb').write(png)
    img = bpy.data.images.load(src)
    img.colorspace_settings.name = 'sRGB'
    w, h = img.size
    if img.channels == 4 and w * h:
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        if px[3::4].min() < 0.999:
            bpy.data.images.remove(img)
            return None
    scene = bpy.context.scene
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    s = scene.render.image_settings
    s.file_format = 'JPEG'
    s.color_mode = 'RGB'
    s.quality = QUALITY
    img.save_render(dst, scene=scene)
    bpy.data.images.remove(img)
    return open(dst, 'rb').read()


def optimise(path):
    gltf, binary = read_glb(path)
    views = gltf.get('bufferViews', [])
    chunks = [binary[v.get('byteOffset', 0): v.get('byteOffset', 0) + v['byteLength']] for v in views]
    before = len(binary)
    converted = 0
    with tempfile.TemporaryDirectory() as tmp:
        for im in gltf.get('images', []):
            if im.get('mimeType') != 'image/png' or 'bufferView' not in im:
                continue
            jpg = to_jpeg(chunks[im['bufferView']], tmp)
            if jpg and len(jpg) < len(chunks[im['bufferView']]):
                chunks[im['bufferView']] = jpg
                im['mimeType'] = 'image/jpeg'
                converted += 1
    if not converted:
        print(f'GLB {os.path.basename(path)}: sin PNG que convertir, no se toca')
        return
    # lay the buffer out again, every view aligned to 4 bytes
    out = bytearray()
    for v, c in zip(views, chunks):
        out += b'\x00' * (-len(out) % 4)
        v['byteOffset'] = len(out)
        v['byteLength'] = len(c)
        out += c
    gltf['buffers'][0]['byteLength'] = len(out)
    write_glb(path, gltf, bytes(out))
    print(f'GLB {os.path.basename(path)}: {converted} imágenes a JPEG, {before // 1024} KB → {len(out) // 1024} KB')


for p in sys.argv[sys.argv.index('--') + 1:]:
    optimise(os.path.abspath(p))
