"""
Los vecinos texturizados, de los FBX de fuentes_3d/npcs a GLB para la aplicación.

  - jóvenes (adulto, adolescente): el modelo del adolescente, que es sobre el que se pintaron
    las texturas, con cada juego de texturas (NPC1, NPC2…)
  - niño: el mismo peinado y la misma forma del adolescente (su pelo), con la pantaloneta del
    niño y su textura de pantalón («Niño»)
  - mayor: su propio modelo con las texturas «Abuelo»

Solo se usa el BaseColor de cada material, mate, como el guía. Cada GLB sale a escala 1 (la
aplicación pone el tamaño de cada edad: 87 % el adolescente, 62 % el niño con la cabeza un
poco más grande) y conserva los puntos vacíos que la aplicación mueve: body, head, armL,
armR, legL y legR.

Uso, desde starter/:
  blender -b --factory-startup --python tools/exportar_npcs_texturas.py -- fuentes_3d/npcs static/assets/characters
Escribe npc-joven-<n>.glb, npc-nino-<n>.glb (uno por cada carpeta NPC<n>) y npc-mayor.glb.
"""
import bpy
import glob
import os
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
TEX = os.path.join(SRC, 'Textures')
MATTE = 0.95


def textures(folder):
    """material (minúsculas) → ruta del BaseColor, de <prefijo>_<material>_BaseColor.jpg"""
    out = {}
    for p in glob.glob(os.path.join(folder, '*_BaseColor.*')):
        stem = os.path.basename(p).rsplit('_BaseColor', 1)[0]
        out[stem.split('_', 1)[1].strip().lower()] = p
    return out


def load(fbx):
    """Importa un FBX; devuelve sus objetos nuevos."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=fbx)
    return [o for o in bpy.data.objects if o not in before]


def remove(objs):
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)


def named(objs, name):
    return next((o for o in objs if o.name.split('.')[0] == name), None)


def paint(maps):
    for m in bpy.data.materials:
        path = maps.get(m.name.split('.')[0].strip().lower())
        if not path:
            continue
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get('Principled BSDF')
        for link in list(bsdf.inputs['Base Color'].links):
            nt.links.remove(link)
        img = nt.nodes.new('ShaderNodeTexImage')
        img.image = bpy.data.images.load(path, check_existing=True)
        nt.links.new(img.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = MATTE
        bsdf.inputs['Metallic'].default_value = 0


def swap_mesh(target, source):
    """target toma la malla (y su colocación bajo la misma articulación) de source."""
    target.data = source.data.copy()
    target.matrix_parent_inverse = source.matrix_parent_inverse.copy()
    target.matrix_basis = source.matrix_basis.copy()


def export(path, objs):
    root = next(o for o in objs if o.parent is None)
    root.name = 'npc'
    root.scale = (1, 1, 1)
    head = named(objs, 'head')
    if head:
        head.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    print(f'[npcs] {os.path.basename(path)}')


def build(name, base_fbx, maps, hair_from=None, legs_from=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = load(base_fbx)
    # the hair of another model (the same hairstyle for every young neighbour)
    if hair_from:
        other = load(hair_from)
        swap_mesh(named(objs, 'pelo'), named(other, 'pelo'))
        remove(other)
    paint(maps)
    export(os.path.join(OUT, f'{name}.glb'), objs)


os.makedirs(OUT, exist_ok=True)
teen = os.path.join(SRC, 'npc_adolescente.fbx')
child = os.path.join(SRC, 'npc_nino.fbx')
elder = os.path.join(SRC, 'npc_mayor.fbx')
child_pants = textures(os.path.join(TEX, 'Niño')) if os.path.isdir(os.path.join(TEX, 'Niño')) else {}
sets = sorted(d for d in os.listdir(TEX) if d.upper().startswith('NPC') and os.path.isdir(os.path.join(TEX, d)))
for i, d in enumerate(sets, 1):
    maps = textures(os.path.join(TEX, d))
    build(f'npc-joven-{i}', teen, maps)
    # the child: its shorts, the teenager's hair, and the child's trouser texture
    build(f'npc-nino-{i}', child, {**maps, **child_pants}, hair_from=teen)
abuelo = os.path.join(TEX, 'Abuelo')
if os.path.isdir(abuelo):
    build('npc-mayor', elder, textures(abuelo))
