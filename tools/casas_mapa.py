"""
Las casas de los barrios, en versión liviana para el mapa de Cali.

En el mapa hay cerca de mil casas y se ven pequeñas, desde arriba: cada una sale con menos
triángulos (el mismo contorno, sin los detalles que a esa distancia no se ven) y con texturas
de 256 px. Son las mismas casas, con sus mismas texturas: el mapa y los barrios quedan en una
sola línea.

Uso, desde starter/:
  blender -b --factory-startup --python tools/casas_mapa.py -- static/assets/houses static/assets/houses/mapa
"""
import bpy
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
TARGET = 700  # triangles per house, more or less
TEX = 256
HOUSES = ['casa-teja', 'casa-dos-pisos', 'casa-techo-ondulado', 'casa-estrato-2', 'casa-estrato-3', 'casa-estrato-4', 'casa-estrato-5']


def tris(objs):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)


def lighten(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + '.glb'))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    before = tris(meshes)
    ratio = min(1, TARGET / max(before, 1))
    if ratio < 1:
        for o in meshes:
            # small pieces keep what they have: they are the ones that would fall apart
            if tris([o]) < 60:
                continue
            mod = o.modifiers.new('menos', 'DECIMATE')
            mod.decimate_type = 'COLLAPSE'
            mod.ratio = ratio
            mod.delimit = {'UV', 'MATERIAL'}
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.ops.object.modifier_apply(modifier=mod.name)
    for img in bpy.data.images:
        if img.size[0] > TEX or img.size[1] > TEX:
            img.scale(TEX, TEX)
            img.file_format = 'JPEG'
            img.pack()
    after = tris(meshes)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, name + '.glb'),
        export_format='GLB',
        export_image_format='JPEG',
        export_jpeg_quality=80,
    )
    print(f'[mapa] {name}: {before} → {after} triángulos')


os.makedirs(OUT, exist_ok=True)
for name in HOUSES:
    lighten(name)
