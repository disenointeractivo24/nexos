"""
Modelos de los vecinos (NPC) para texturizar, uno por edad, en FBX.

Parte del guía exportado (static/assets/characters/guia.glb): el mismo cuerpo y el
mismo rig de puntos vacíos (body, head, armL, armR, legL, legR), sin casco ni
maletín. Lo que se añade va en piezas aparte, cada una colgada de su articulación:

  - ropa: capas de tela que siguen la forma del cuerpo, cortadas recto y con grosor
    (camiseta, pantalón o pantaloneta, zapatos);
  - pelo y orejas.

Materiales (uno por conjunto de textura en Substance): Piel, Camiseta, Pantalon,
Zapatos, Pelo. La geometría del guía no se toca: la piel queda debajo de la ropa.

Edades:
  adulto       camiseta de manga corta, pantalón largo, pelo corto con flequillo
  adolescente  igual de complexión, más bajo (87 %), flequillo largo con copete
  nino         62 % de alto y la cabeza un poco más grande; pantaloneta, pelo de casquete
  mayor        manga larga, pelo canoso que retrocede en la frente, sin flequillo
               (la postura encorvada y el paso lento los pone la aplicación)

Uso, desde starter/:
  blender -b --factory-startup --python tools/exportar_npcs.py -- static/assets/characters/guia.glb fuentes_3d/npcs
Escribe npc_<edad>.fbx y una vista previa npc_<edad>.png por edad.
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
os.makedirs(OUT, exist_ok=True)

# Alturas donde cambia la ropa, en las unidades del modelo (el guía mide ~4,2 sin casco).
# Son las mismas que usa la aplicación (src/three/neighbour.js) en su escala.
CUT = {'shoe': 0.325, 'hips': 1.075, 'sleeve': 1.5, 'long_sleeve': 1.12, 'knee': 0.62}
# Cuánto se separa la tela del cuerpo, y su grosor
OFF = {'Camiseta': 0.022, 'Pantalon': 0.026, 'Zapatos': 0.034}
THICK = 0.014
REMOVE = ('CASCO', 'Backpack', 'Correas', 'Cierre')

AGES = {
    'adulto': {'scale': 1.0, 'sleeve': CUT['sleeve'], 'shorts': False, 'hair': 'adulto',
               'colors': {'Piel': (0.89, 0.71, 0.55), 'Camiseta': (0.94, 0.91, 0.87), 'Pantalon': (0.29, 0.40, 0.54), 'Zapatos': (0.95, 0.94, 0.92), 'Pelo': (0.23, 0.15, 0.09)}},
    'adolescente': {'scale': 0.87, 'sleeve': CUT['sleeve'], 'shorts': False, 'hair': 'adolescente',
                    'colors': {'Piel': (0.79, 0.56, 0.39), 'Camiseta': (0.27, 0.48, 0.62), 'Pantalon': (0.18, 0.24, 0.36), 'Zapatos': (0.9, 0.9, 0.88), 'Pelo': (0.12, 0.09, 0.07)}},
    'nino': {'scale': 0.62, 'head': 1.16, 'sleeve': CUT['sleeve'], 'shorts': True, 'hair': 'nino',
             'colors': {'Piel': (0.95, 0.79, 0.65), 'Camiseta': (0.91, 0.44, 0.32), 'Pantalon': (0.29, 0.40, 0.54), 'Zapatos': (0.97, 0.95, 0.92), 'Pelo': (0.35, 0.23, 0.13)}},
    'mayor': {'scale': 1.0, 'sleeve': CUT['long_sleeve'], 'shorts': False, 'hair': 'mayor',
              'colors': {'Piel': (0.89, 0.71, 0.55), 'Camiseta': (0.71, 0.54, 0.42), 'Pantalon': (0.42, 0.37, 0.31), 'Zapatos': (0.35, 0.27, 0.21), 'Pelo': (0.86, 0.85, 0.82)}},
}


def joint_of(o):
    p = o.parent
    while p:
        if p.name in ('body', 'head', 'armL', 'armR', 'legL', 'legR'):
            return p.name
        p = p.parent
    return None


def material(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = 0.9
    m.diffuse_color = (*rgb, 1)
    return m


def link(ob, parent):
    bpy.context.collection.objects.link(ob)
    mw = ob.matrix_world.copy()
    ob.parent = parent
    ob.matrix_parent_inverse = parent.matrix_world.inverted()
    ob.matrix_world = mw


def shell(src, name, lo, hi, mat):
    """A layer of cloth over part of `src`: the part between heights lo and hi (world),
    cut straight, lifted off the body and given thickness."""
    bm = bmesh.new()
    bm.from_mesh(src.data)
    mw = src.matrix_world.copy()
    bm.transform(mw)
    geom = lambda: bm.verts[:] + bm.edges[:] + bm.faces[:]
    if lo is not None:
        bmesh.ops.bisect_plane(bm, geom=geom(), plane_co=(0, 0, lo), plane_no=(0, 0, 1), clear_inner=True)
    if hi is not None:
        bmesh.ops.bisect_plane(bm, geom=geom(), plane_co=(0, 0, hi), plane_no=(0, 0, 1), clear_outer=True)
    if not bm.faces:
        bm.free()
        return None
    bm.normal_update()
    off = OFF[mat.name]
    for v in bm.verts:
        v.co += v.normal * off
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    link(ob, src.parent)
    mod = ob.modifiers.new('grosor', 'SOLIDIFY')
    mod.thickness = THICK
    mod.offset = 1
    mod.use_rim = True
    mod.use_even_offset = True
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.select_set(False)
    return ob


def ellipsoid(bm, uv, center, scale, rot=Matrix.Identity(3), segments=24, rings=14, keep_above=None, thick=0, cut=None):
    """An ellipsoid (optionally only its top, above `keep_above` on the unit sphere, then given
    `thick`ness so it is a closed solid too) added to bm."""
    m = Matrix.Translation(center) @ rot.to_4x4() @ Matrix.Diagonal((*scale, 1))
    res = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1, matrix=Matrix.Identity(4), calc_uvs=True)
    verts = res['verts']
    if keep_above is not None:
        keep = keep_above if callable(keep_above) else (lambda co: co.z >= keep_above)
        drop = [v for v in verts if not keep(v.co)]
        bmesh.ops.delete(bm, geom=drop, context='VERTS')
        verts = [v for v in verts if v.is_valid]
    bmesh.ops.transform(bm, matrix=m, verts=verts)
    if cut is not None:
        # a clean, curved edge: everything on the far side of the plane (point, normal) goes
        faces = list({f for v in verts for f in v.link_faces})
        edges = list({e for f in faces for e in f.edges})
        res = bmesh.ops.bisect_plane(bm, geom=verts + edges + faces, plane_co=cut[0], plane_no=cut[1], clear_outer=True)
        verts = [v for v in verts if v.is_valid] + [g for g in res['geom_cut'] if isinstance(g, bmesh.types.BMVert)]
    if keep_above is not None and thick:
        faces = list({f for v in verts if v.is_valid for f in v.link_faces})
        bmesh.ops.solidify(bm, geom=faces, thickness=thick)


def hair_and_ears(head_mesh, style, pelo, piel):
    ws = [head_mesh.matrix_world @ Vector(c) for c in head_mesh.bound_box]
    mn = Vector((min(v.x for v in ws), min(v.y for v in ws), min(v.z for v in ws)))
    mx = Vector((max(v.x for v in ws), max(v.y for v in ws), max(v.z for v in ws)))
    c, s = (mn + mx) / 2, mx - mn          # s.x ancho, s.y fondo, s.z alto; el frente es -Y
    rx = lambda a: Matrix.Rotation(a, 3, 'X')
    ry = lambda a: Matrix.Rotation(a, 3, 'Y')

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    # el casquete: arriba y atrás, inclinado hacia atrás para dejar la cara libre
    # (children: a bowl cut, the cap brought down over the forehead; older people have none:
    # the top of the head is bare, the hair is round the back and over the ears)
    tip = {'adulto': -0.42, 'adolescente': -0.36, 'nino': -0.1}.get(style)
    cap_scale = {'nino': (0.565, 0.585, 0.6), 'adolescente': (0.55, 0.57, 0.6)}.get(style, (0.545, 0.56, 0.56))
    if tip is not None:
        ellipsoid(bm, uv, c + Vector((0, s.y * 0.02, s.z * 0.05)), (s.x * cap_scale[0], s.y * cap_scale[1], s.z * cap_scale[2]), rx(tip),
                  segments=40, rings=20, keep_above=-0.02 if style == 'nino' else -0.31, thick=s.x * 0.035)
    else:
        # one band round the back of the head, from ear to ear, below the crown
        # the same cap, cut by a tilted plane: the crown and the forehead are bare, and the hair
        # that is left runs round the back of the head from ear to ear
        ellipsoid(bm, uv, c + Vector((0, s.y * 0.02, s.z * 0.05)), (s.x * 0.555, s.y * 0.575, s.z * 0.57), rx(-0.42), segments=48, rings=24,
                  keep_above=-0.31, thick=s.x * 0.05, cut=(c + Vector((0, s.y * 0.06, s.z * 0.1)), Vector((0, -0.62, 0.78)).normalized()))
    # el flequillo: mechones sobre la frente [x, alto, frente, ancho, giro]
    locks = {
        'adulto': [(-0.25, 0.27, 0.36, 0.32, 0.5), (-0.02, 0.3, 0.4, 0.34, 0.3), (0.22, 0.27, 0.37, 0.3, 0.1), (0.38, 0.14, 0.27, 0.22, -0.4), (-0.4, 0.12, 0.25, 0.22, 0.6)],
        'adolescente': [(-0.3, 0.26, 0.38, 0.36, 0.6), (-0.05, 0.3, 0.42, 0.4, 0.45), (0.2, 0.27, 0.4, 0.36, 0.3), (0.4, 0.12, 0.3, 0.24, -0.3),
                        (-0.42, 0.1, 0.27, 0.24, 0.7), (0.05, 0.4, 0.22, 0.36, 0.2)],
        'nino': [],
        'mayor': [],
    }[style]
    for x, y, z, w, tilt in locks:
        ellipsoid(bm, uv, c + Vector((x * s.x, -z * s.y, y * s.z)), (s.x * w, s.y * 0.2, s.z * 0.13), rx(-0.5) @ ry(-tilt), segments=20, rings=12)
    # the pieces become one clean surface: given thickness, fused as a volume, and rebuilt in
    # even quads, with its own UVs
    me = bpy.data.meshes.new('pelo')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('pelo', me)
    link(ob, head_mesh.parent)
    if locks:
        retopo(ob, voxel=s.x * 0.012, faces=2600)
    else:
        # a single piece cut from a sphere already has tidy quads and its own UVs
        for p in ob.data.polygons:
            p.use_smooth = True
    me = ob.data
    me.materials.clear()
    me.materials.append(pelo)

    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    for side in (-1, 1):
        ellipsoid(bm, uv, c + Vector((side * s.x * 0.535, s.y * 0.02, -s.z * 0.05)), (s.x * 0.085, s.y * 0.1, s.z * 0.135), segments=16, rings=12)
    me = bpy.data.meshes.new('orejas')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(piel)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new('orejas', me)
    link(ob, head_mesh.parent)


def retopo(ob, voxel, faces):
    """One watertight surface of even quads from overlapping closed pieces, unwrapped."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    ob.data.remesh_voxel_size = voxel
    bpy.ops.object.voxel_remesh()
    # QuadriFlow sometimes gives up (and says nothing): try again without symmetry, then with
    # another seed, and only as a last resort thin the voxel surface out
    tries = [{'use_mesh_symmetry': True}, {'use_mesh_symmetry': False}]
    tries += [{'use_mesh_symmetry': sym, 'seed': seed, 'target_faces': t} for seed in (3, 7, 11, 19) for sym in (True, False) for t in (faces, int(faces * 1.3))]
    for kw in tries:
        if len(ob.data.polygons) <= faces * 1.6:
            break
        try:
            bpy.ops.object.quadriflow_remesh(**{'target_faces': faces, 'use_preserve_sharp': False, 'smooth_normals': True, **kw})
        except Exception as e:
            print('quadriflow:', e)
    if len(ob.data.polygons) > faces * 1.6:
        print('quadriflow: no, se reduce la malla')
        dec = ob.modifiers.new('menos', 'DECIMATE')
        dec.ratio = faces / len(ob.data.polygons)
        bpy.ops.object.modifier_apply(modifier=dec.name)
    smooth = ob.modifiers.new('suave', 'SMOOTH')
    smooth.factor = 0.5
    smooth.iterations = 8
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    for p in ob.data.polygons:
        p.use_smooth = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    ob.select_set(False)


BACK = float(os.environ.get("NPC_BACK", "1"))


def preview(path, height):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 600, 800
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    scene.world = world
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    target = Vector((0, 0, height * 0.48))
    pos = Vector((height * 1.1, -height * 2.6 * BACK, height * 0.95))
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 50
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


for age, spec in AGES.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC, merge_vertices=True)
    mats = {k: material(k, rgb) for k, rgb in spec['colors'].items()}
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        name = o.material_slots[0].material.name if o.material_slots and o.material_slots[0].material else ''
        if any(name.startswith(r) for r in REMOVE):
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(mats['Piel'])
        o.name = {'body': 'cuerpo', 'head': 'cabeza', 'armL': 'brazoL', 'armR': 'brazoR', 'legL': 'piernaL', 'legR': 'piernaR'}[joint_of(o)]

    by = {joint_of(o): o for o in meshes}
    # camiseta: el torso sobre la cadera y los brazos sobre la manga
    shell(by['body'], 'camiseta', CUT['hips'] - 0.02, None, mats['Camiseta'])
    for j, n in (('armL', 'camiseta_mangaL'), ('armR', 'camiseta_mangaR')):
        shell(by[j], n, spec['sleeve'], None, mats['Camiseta'])
    # pantalón (o pantaloneta): el torso bajo la cadera y las piernas sobre el zapato (o la rodilla)
    shell(by['body'], 'pantalon', None, CUT['hips'] + 0.02, mats['Pantalon'])
    for j, n in (('legL', 'pantalon_piernaL'), ('legR', 'pantalon_piernaR')):
        shell(by[j], n, CUT['knee'] if spec['shorts'] else CUT['shoe'] + 0.01, None, mats['Pantalon'])
        shell(by[j], n.replace('pantalon_pierna', 'zapato'), None, CUT['shoe'] + 0.02, mats['Zapatos'])
    hair_and_ears(by['head'], spec['hair'], mats['Pelo'], mats['Piel'])

    root = bpy.data.objects['guia']
    root.name = f'npc_{age}'
    root.scale = (spec['scale'],) * 3
    if spec.get('head'):
        bpy.data.objects['head'].scale = (spec['head'],) * 3
    bpy.context.view_layer.update()

    fbx = os.path.join(OUT, f'npc_{age}.fbx')
    bpy.ops.export_scene.fbx(filepath=fbx, use_selection=False, object_types={'EMPTY', 'MESH'}, apply_scale_options='FBX_SCALE_ALL',
                             mesh_smooth_type='FACE', add_leaf_bones=False, use_mesh_modifiers=True, axis_forward='-Z', axis_up='Y',
                             path_mode='STRIP')
    tris = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
    print(f'NPC {age}: {fbx} ({tris} caras)')
    preview(os.path.join(OUT, f'npc_{age}.png'), 4.3 * spec['scale'] * (1.04 if spec.get('head') else 1))
