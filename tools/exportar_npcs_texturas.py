"""
Los vecinos texturizados, de los modelos con UV de Substance a GLB para la aplicación.

Fuentes (fuentes_3d/npcs/):
  - npc1.glb      el joven (sobre el que se pintaron NPC1, NPC2…), con sus UV
  - abuelo.glb    el mayor, con sus UV («Abuelo»)
  - npc_adolescente.fbx, npc_mayor.fbx, npc_nino.fbx: los modelos originales, que dicen a qué
    articulación pertenece cada pieza (la geometría es la misma, solo cambian las UV)

Al texturizar, las piezas que comparten material quedan unidas (toda la camiseta, toda la piel
de la cabeza y los brazos…). La aplicación mueve cada pieza con su articulación, así que el
script las separa otra vez y cuelga cada una de la suya: body, head, armL, armR, legL, legR.

Salen:
  - npc-joven-<n>   adulto y adolescente, con el juego NPC<n>
  - npc-nino-<n>    el mismo joven (mismo peinado) con la pantaloneta del niño y su textura («Niño»)
  - npc-mayor       el mayor con «Abuelo»
Todos a la escala del guía (la aplicación pone el tamaño de cada edad). Solo BaseColor, mate.

Uso, desde starter/:
  blender -b --factory-startup --python tools/exportar_npcs_texturas.py -- fuentes_3d/npcs static/assets/characters
"""
import bpy
import glob
import numpy as np
import os
import sys
from collections import Counter
from mathutils import Vector
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
TEX = os.path.join(SRC, 'Textures')
JOINTS = ('body', 'head', 'armL', 'armR', 'legL', 'legR')
BODY_Z = 0.886  # where the guide's hips sit, at full size: every model is brought to it
MATTE = 0.95


def textures(folder):
    """material (minúsculas) → ruta del BaseColor, de <prefijo>_<material>_BaseColor.jpg"""
    out = {}
    for p in glob.glob(os.path.join(folder, '*_BaseColor.*')):
        stem = os.path.basename(p).rsplit('_BaseColor', 1)[0]
        out[stem.split('_', 1)[1].strip().lower()] = p
    return out


def load(path):
    before = set(bpy.data.objects)
    if path.lower().endswith('.fbx'):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def joint_of(o):
    p = o.parent
    while p:
        base = p.name.split('.')[0]
        if base in JOINTS:
            return base
        p = p.parent
    return None


def named(objs, name):
    return next((o for o in objs if o.name.split('.')[0] == name and o.type == 'EMPTY'), None)


def separate_loose(o):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    return list(bpy.context.selected_objects)


def hang(o, joint):
    mw = o.matrix_world.copy()
    o.parent = joint
    o.matrix_parent_inverse = joint.matrix_world.inverted()
    o.matrix_world = mw


def rig(objs, ref_path):
    """Each loose piece of every mesh hangs from the joint its twin hangs from in the original."""
    ref = load(ref_path)
    bpy.context.view_layer.update()
    pts, owners = [], []
    for r in ref:
        if r.type != 'MESH':
            continue
        j = joint_of(r)
        for v in r.data.vertices:
            pts.append(r.matrix_world @ v.co)
            owners.append(j)
    tree = KDTree(len(pts))
    for i, p in enumerate(pts):
        tree.insert(p, i)
    tree.balance()
    for r in ref:
        bpy.data.objects.remove(r, do_unlink=True)
    pieces = []
    for o in [o for o in objs if o.type == 'MESH']:
        pieces += separate_loose(o)
    joints = {j: named(objs, j) for j in JOINTS}
    worst = 0
    for p in pieces:
        votes = Counter()
        verts = p.data.vertices
        step = max(1, len(verts) // 60)
        for v in list(verts)[::step]:
            co, i, d = tree.find(p.matrix_world @ v.co)
            votes[owners[i]] += 1
            worst = max(worst, d)
        j = votes.most_common(1)[0][0]
        if joints.get(j):
            hang(p, joints[j])
    # back together: one mesh per joint and material (few draw calls for the phone)
    groups = {}
    for p in pieces:
        if not p.parent:
            continue
        mat = p.material_slots[0].material.name if p.material_slots and p.material_slots[0].material else ''
        groups.setdefault((p.parent.name, mat), []).append(p)
    for (joint, mat), group in groups.items():
        if len(group) > 1:
            bpy.ops.object.select_all(action='DESELECT')
            for p in group:
                p.select_set(True)
            bpy.context.view_layer.objects.active = group[0]
            bpy.ops.object.join()
        group[0].name = f'{joint.split(".")[0]}_{mat.split(".")[0].lower() or "pieza"}'
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    print(f'[npcs] {len(pieces)} piezas colgadas de sus articulaciones (desvío máximo {worst:.4f}), unidas en {len(meshes)} mallas')
    return [o for o in bpy.data.objects]


def full_size(objs):
    """Bring the model to the guide's size (a teenager's file comes at 87 %)."""
    root = next(o for o in objs if o.parent is None)
    body = named(objs, 'body')
    bpy.context.view_layer.update()
    k = BODY_Z / body.matrix_world.translation.z
    root.scale = root.scale * k
    bpy.context.view_layer.update()
    return root


def paint(objs, maps, only=None):
    """BaseColor on every material named like a texture (matte). `only`: limit to these objects."""
    seen = set()
    for o in objs:
        if o.type != 'MESH' or (only is not None and o not in only):
            continue
        for slot in o.material_slots:
            m = slot.material
            if not m or m in seen:
                continue
            seen.add(m)
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


def skin_tone(path):
    """The skin's own colour (the median of its lighter third: the painted skin, not the shaded
    or unpainted parts), linear, for the parts the texture never painted."""
    img = bpy.data.images.load(path, check_existing=True)
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    c = px.reshape(-1, 4)[:, :3]
    lum = c @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    rgb = np.median(c[lum >= np.quantile(lum, 0.67)], axis=0)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    return (*lin.tolist(), 1)


def plain_legs(maps):
    """The child's legs show below the shorts, where the skin texture (painted under long
    trousers) was never finished: they take the skin's own tone instead."""
    if 'piel' not in maps:
        return
    mat = bpy.data.materials.new('PielPiernas')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = skin_tone(maps['piel'])
    bsdf.inputs['Roughness'].default_value = MATTE
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.parent and o.parent.name.split('.')[0] in ('legL', 'legR') and o.material_slots and (o.material_slots[0].material.name.lower().startswith('piel')):
            o.data.materials.clear()
            o.data.materials.append(mat)


def export(path):
    objs = list(bpy.data.objects)
    root = next(o for o in objs if o.parent is None)
    root.name = 'npc'
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    print(f'[npcs] {os.path.basename(path)}')


def young(maps, shorts=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = rig(load(os.path.join(SRC, 'npc1.glb')), os.path.join(SRC, 'npc_adolescente.fbx'))
    full_size(objs)
    if shorts is not None:
        # the child: out with the long trousers, in with the original model's shorts (whose UVs
        # the child's trouser texture was painted on), each on the same joint
        for o in [o for o in bpy.data.objects if o.type == 'MESH' and any(s.material and s.material.name.lower().startswith('pantalon') for s in o.material_slots)]:
            bpy.data.objects.remove(o, do_unlink=True)
        mine = list(bpy.data.objects)
        child = load(os.path.join(SRC, 'npc_nino.fbx'))
        croot = next(o for o in child if o.parent is None)
        croot.scale = (1, 1, 1)
        chead = named(child, 'head')
        if chead:
            chead.scale = (1, 1, 1)
        bpy.context.view_layer.update()
        pants = [o for o in child if o.type == 'MESH' and any(s.material and s.material.name.lower().startswith('pantalon') for s in o.material_slots)]
        mat = bpy.data.materials.new('PantalonNino')
        mat.use_nodes = True
        for p in pants:
            j = named(mine, joint_of(p))
            hang(p, j)
            p.data.materials.clear()
            p.data.materials.append(mat)
        for o in child:
            if o not in pants:
                bpy.data.objects.remove(o, do_unlink=True)
        paint(pants, {'pantalonnino': shorts}, only=pants)
        plain_legs(maps)
    paint(list(bpy.data.objects), maps)


os.makedirs(OUT, exist_ok=True)
child_pants = next(iter(textures(os.path.join(TEX, 'Niño')).values()), None) if os.path.isdir(os.path.join(TEX, 'Niño')) else None
sets = sorted(d for d in os.listdir(TEX) if d.upper().startswith('NPC') and os.path.isdir(os.path.join(TEX, d)))
for i, d in enumerate(sets, 1):
    maps = textures(os.path.join(TEX, d))
    young(maps)
    export(os.path.join(OUT, f'npc-joven-{i}.glb'))
    if child_pants:
        young(maps, shorts=child_pants)
        export(os.path.join(OUT, f'npc-nino-{i}.glb'))
abuelo = os.path.join(TEX, 'Abuelo')
if os.path.isdir(abuelo) and os.path.exists(os.path.join(SRC, 'abuelo.glb')):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = rig(load(os.path.join(SRC, 'abuelo.glb')), os.path.join(SRC, 'npc_mayor.fbx'))
    full_size(objs)
    paint(list(bpy.data.objects), textures(abuelo))
    export(os.path.join(OUT, 'npc-mayor.glb'))
