"""
The guide ("muñequito") from its .blend -> GLB for the experience (Blender 4.2+ / 5.x, in the background):

    blender -b --factory-startup fuentes_3d/guia/muñequito.blend --python tools/exportar_guia.py -- static/assets/characters/guia.glb

The character is a puppet: every part (legs, torso, arms, head with its helmet,
the backpack) is a separate, rigid piece hanging from a curve that works as its
joint. The script keeps that rig exactly as it was made; it only:

- keeps what is visible in the viewport (hidden objects are old versions), plus
  any hidden piece listed in FACE, hung from the head;
- turns each joint curve into an empty at the same place, named as the app moves
  it: body (hips and torso), head, armL, armR, legL, legR. They are recognised by
  where they are, so renaming the curves in Blender does not matter;
- if the textured version is next to it (muñequito_texturas.fbx and texturas/,
  from Substance Painter), uses its pieces and their BaseColor (matte; the other
  maps are not used): the FBX has the pieces joined by material, so they are
  taken apart again and each goes back to its joint;
- gives a colour to the pieces that still have none: cream skin and the orange
  helmet;
- exports a GLB with the modifiers applied.

The source file is only read, never saved over.

Blender: -Y is the front, Z is up, feet on Z = 0. L is the -X side.
"""

import os
import sys

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]

# extra pieces to keep even while hidden in the file, hung from the head (e.g. eyes and mouth:
# ["Cube.005", "Cube.006"]). Empty for now: in this version they sit inside the new, larger head.
FACE = []

# the textured version made in Substance Painter, next to the .blend: an FBX with the pieces
# joined by material, and its textures named <prefix>_<material>_<Map>.jpg
HERE = os.path.dirname(bpy.data.filepath)
TEXTURED_FBX = os.path.join(HERE, "muñequito_texturas.fbx")
TEXTURES = os.path.join(HERE, "texturas")
TEX_PREFIX = "muñequito_texturas"
# only the BaseColor of each material is used; the surface is matte
MATTE_ROUGHNESS = 0.95


def hex_color(h):
    """An sRGB hex colour as Blender's linear RGBA (Base Color is linear)."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


def material(name, color, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_color(color)
    bsdf.inputs["Roughness"].default_value = roughness
    m.diffuse_color = hex_color(color)
    return m


scene = bpy.context.scene
view = bpy.context.view_layer

# 1. the rig: the visible joint curves, from the one without a parent down
joints = [o for o in scene.objects if o.type == "CURVE" and o.visible_get()]
roots = [o for o in joints if o.parent is None or o.parent not in joints]
if len(roots) != 1:
    raise SystemExit(f"[guia] expected one top joint, found {[o.name for o in roots]}")
root = roots[0]


def role(j):
    """What a joint moves, from where it is."""
    p = j.matrix_world.translation
    if j is root:
        return "guia"
    if any(c in joints for c in j.children):
        return "body"
    if p.z < 1.3:
        return "legL" if p.x < 0 else "legR"
    if abs(p.x) < 0.15:
        return "head"
    return "armL" if p.x < 0 else "armR"


names = {j: role(j) for j in joints}
taken = {}
for j, n in names.items():
    if n in taken:
        raise SystemExit(f"[guia] {j.name} and {taken[n].name} both look like '{n}'")
    taken[n] = j
missing = {"body", "head", "armL", "armR", "legL", "legR"} - set(taken)
if missing:
    raise SystemExit(f"[guia] no joint found for {sorted(missing)}")
for j, n in names.items():
    print(f"[guia] {j.name} -> {n} at {tuple(round(c, 2) for c in j.matrix_world.translation)}")

# 2. what stays: the visible pieces under the rig, and the face
def under_rig(o):
    p = o.parent
    while p:
        if p is root:
            return True
        p = p.parent
    return False


pieces = [o for o in scene.objects if o.type == "MESH" and o.visible_get() and under_rig(o) and len(o.data.vertices)]
face = [scene.objects[n] for n in FACE if n in scene.objects]
for o in face:
    o.hide_set(False)
    o.hide_viewport = False
    o.hide_render = False
    mw = o.matrix_world.copy()
    o.parent = taken["head"]
    o.matrix_world = mw
keep = set(pieces) | set(face) | set(joints)
for o in list(scene.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)

# 2b. the textured version, if there is one. Substance Painter worked on an FBX where the
#     pieces that share a material were joined (all the skin is one "Body", the backpack is
#     split in three). Its pieces are taken apart again, each loose part goes back to the
#     joint of the piece it came from, and the rig's own, untextured pieces are dropped.
def bbox_centre(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return sum(pts, Vector()) / 8


if os.path.exists(TEXTURED_FBX):
    rig_pieces = [(p, bbox_centre(p), p.parent) for p in pieces]
    # every vertex of the rig's pieces (modifiers applied, in world space), to tell which
    # piece each textured part was made from: they share their vertices exactly
    dg = bpy.context.evaluated_depsgraph_get()
    owner = []
    for i, (p, _, _) in enumerate(rig_pieces):
        me = bpy.data.meshes.new_from_object(p.evaluated_get(dg))
        me.transform(p.matrix_world)
        owner += [(v.co.copy(), i) for v in me.vertices]
        bpy.data.meshes.remove(me)
    kd = KDTree(len(owner))
    for j, (co, _) in enumerate(owner):
        kd.insert(co, j)
    kd.balance()
    before = set(scene.objects)
    bpy.ops.import_scene.fbx(filepath=TEXTURED_FBX)
    imported = [o for o in scene.objects if o not in before]
    for o in imported:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    meshes = [o for o in scene.objects if o not in before and o.type == "MESH"]
    far = 0.0
    # every loose part on its own
    parts = []
    for m in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        m.select_set(True)
        view.objects.active = m
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")
        parts += [o for o in bpy.context.selected_objects]
    # each part hangs from the joint of the rig piece it was made from: the piece most of its
    # vertices fall on. (Not the nearest centre: a backpack pocket sits right next to an arm.)
    for part in parts:
        votes = {}
        for v in part.data.vertices:
            co, j, d = kd.find(part.matrix_world @ v.co)
            far = max(far, d)
            votes[owner[j][1]] = votes.get(owner[j][1], 0) + 1
        best = rig_pieces[max(votes, key=votes.get)]
        mw = part.matrix_world.copy()
        part.parent = best[2]
        part.matrix_world = mw
        print(f"[guia]   {part.name} ({part.data.materials[0].name if part.data.materials else '-'}) -> {best[0].name} / {best[2].name}")
    for p, _, _ in rig_pieces:
        bpy.data.objects.remove(p, do_unlink=True)
    pieces = parts
    print(f"[guia] textured: {len(meshes)} meshes from the FBX, {len(parts)} pieces (largest vertex gap to the rig: {far:.4f})")

    def tex(material, kind):
        for ext in ("png", "jpg", "jpeg"):
            p = os.path.join(TEXTURES, f"{TEX_PREFIX}_{material}_{kind}.{ext}")
            if os.path.exists(p):
                return p
        return None

    done = set()
    for part in pieces:
        for m in part.data.materials:
            if not m or m.name in done:
                continue
            done.add(m.name)
            base = tex(m.name, "BaseColor")
            if not base:
                print(f"[guia] {m.name}: no textures, kept as it is")
                continue
            m.use_nodes = True
            nt = m.node_tree
            bsdf = nt.nodes.get("Principled BSDF") or nt.nodes.new("ShaderNodeBsdfPrincipled")

            def image(path, colour):
                n = nt.nodes.new("ShaderNodeTexImage")
                n.image = bpy.data.images.load(path, check_existing=True)
                n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
                return n

            # only the colour: the look is the BaseColor as painted, matte, with no shine
            # (the other maps exported by Substance are left out on purpose)
            for link in list(nt.links):
                if link.to_node == bsdf:
                    nt.links.remove(link)
            nt.links.new(image(base, True).outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Roughness"].default_value = MATTE_ROUGHNESS
            bsdf.inputs["Metallic"].default_value = 0
            if "Specular IOR Level" in bsdf.inputs:
                bsdf.inputs["Specular IOR Level"].default_value = 0.2
            print(f"[guia] {m.name}: BaseColor")

# 3. colours for the pieces that have none
skin = material("guia_piel", "#F4EFE7", 0.58)
dark = material("guia_cara", "#1C1E22", 0.3)
helmet = material("guia_casco", "#F2A13A", 0.42)
head_top = max((max((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in pieces if o.parent is taken["head"]), default=0)
for o in pieces + face:
    if any(o.data.materials):
        continue
    top = max((o.matrix_world @ Vector(c)).z for c in o.bound_box)
    if o in face:
        m = dark
    elif o.parent is taken["head"] and top >= head_top - 1e-3 and top > 4.3:
        m = helmet  # the piece of the head that reaches highest is the helmet
    else:
        m = skin
    o.data.materials.clear()
    o.data.materials.append(m)
    print(f"[guia] {o.name}: {m.name}")

# 4. each joint curve becomes an empty in the same place, named for the app
empties = {}
for j in joints:
    e = bpy.data.objects.new(names[j], None)
    e.empty_display_type = "PLAIN_AXES"
    e.empty_display_size = 0.2
    scene.collection.objects.link(e)
    e.matrix_world = j.matrix_world.copy()
    empties[j] = e
for j, e in empties.items():
    if j.parent in empties:
        mw = e.matrix_world.copy()
        e.parent = empties[j.parent]
        e.matrix_world = mw
for o in list(scene.objects):
    if o.parent in empties:
        mw = o.matrix_world.copy()
        o.parent = empties[o.parent]
        o.matrix_world = mw
for j in joints:
    bpy.data.objects.remove(j, do_unlink=True)

# 5. export
for o in scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_yup=True,
)
print(f"[guia] wrote {OUT}: {len(pieces)} pieces, {len(face)} face pieces")
