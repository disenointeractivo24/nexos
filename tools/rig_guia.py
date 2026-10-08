"""
The guide ("muñequito") from its .blend -> rigged GLB for the experience (Blender 4.2+ / 5.x, in the background):

    blender -b --factory-startup <muñequito.blend> --python tools/rig_guia.py -- <out.glb> [out.blend]

The source file is only read, never saved over. What the script does:

- keeps the meshes that are visible in the viewport (hidden ones are old versions
  or blockouts) and applies their modifiers (mirror, subdivision, solidify);
- drops face pieces that sit entirely inside the head, where nobody sees them;
- keeps the materials a piece already has; one without gets a cream "skin" (the
  body) or a dark "face" (eyes, mouth);
- builds a small skeleton with the names the app animates — body, head, armL,
  armR, legL, legR — and weights the mesh to it by region, with soft blends at
  the neck, shoulders and hips so nothing tears when an arm swings;
- exports a GLB (no animation clips: the app moves these bones itself).

Every bone points straight up with no roll, so in three.js its rest rotation is
zero and the app can rotate it exactly like the stand-in's pivots.

Blender: -Y is the front, Z is up, feet on Z = 0 (as the model was made).
`L` is the -X side and `R` the +X side, the same as the procedural stand-in.
"""

import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
OUT_BLEND = argv[1] if len(argv) > 1 else None

def hex_color(h):
    """An sRGB hex colour as Blender's linear RGBA (Base Color is linear)."""
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c) + (1.0,)


SKIN = hex_color("#F4EFE7")  # as the stand-in
FACE = hex_color("#1C1E22")

# Where the joints are, in the model's own units (it stands 4 units tall)
NECK_Z = 2.06
SHOULDER = Vector((0.66, 0.0, 1.84))
HIP = Vector((0.33, 0.0, 0.74))
HANDS_Z = 0.76  # lowest point of the hands


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def material(name, color, roughness):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    m.diffuse_color = color
    return m


scene = bpy.context.scene
view = bpy.context.view_layer

# 1. only what is visible, with its modifiers applied, as plain meshes in world space
dg = bpy.context.evaluated_depsgraph_get()
sources = [o for o in scene.objects if o.type == "MESH" and o.visible_get()]
baked = []
for o in sources:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    me.transform(o.matrix_world)
    baked.append((o.name, me))
for o in list(scene.objects):
    bpy.data.objects.remove(o, do_unlink=True)

# the body is the biggest piece; it decides what is "inside the head"
baked.sort(key=lambda p: -len(p[1].vertices))
body_name, body_me = baked[0]
inside = bpy.data.objects.new("probe", body_me)
scene.collection.objects.link(inside)
view.update()


def hidden_inside(me):
    """True when every vertex of a piece lies inside the body mesh (closest-point normal test)."""
    for v in me.vertices:
        ok, loc, normal, _ = inside.closest_point_on_mesh(v.co)
        if not ok or (v.co - loc).dot(normal) > 0:
            return False
    return True


face_meshes = []
for name, me in baked[1:]:
    if hidden_inside(me):
        print(f"[guia] drop {name}: inside the head")
        continue
    face_meshes.append((name, me))
bpy.data.objects.remove(inside, do_unlink=True)

skin = material("guia_piel", SKIN, 0.58)
face = material("guia_cara", FACE, 0.3)

# 2. one mesh. A piece that already has its own materials (a helmet, a backpack) keeps them;
#    one without gets cream if it is the body, dark if it is a face piece
materials = []


def slot(m):
    if m not in materials:
        materials.append(m)
    return materials.index(m)


bm = bmesh.new()
for i, (_, me) in enumerate([(body_name, body_me)] + face_meshes):
    fallback = skin if i == 0 else face
    own = [m for m in me.materials]
    tmp = bmesh.new()
    tmp.from_mesh(me)
    for f in tmp.faces:
        m = own[f.material_index] if f.material_index < len(own) and own[f.material_index] else fallback
        f.material_index = slot(m)
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
for f in bm.faces:
    f.smooth = True
mesh = bpy.data.meshes.new("guia")
bm.to_mesh(mesh)
bm.free()
for m in materials:
    mesh.materials.append(m)
obj = bpy.data.objects.new("guia", mesh)
scene.collection.objects.link(obj)

# 3. skeleton: every bone points up (+Z) with no roll
arm_data = bpy.data.armatures.new("guia_rig")
rig = bpy.data.objects.new("guia_rig", arm_data)
scene.collection.objects.link(rig)
view.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
UP = Vector((0, 0, 0.35))


def bone(name, head, parent=None):
    b = arm_data.edit_bones.new(name)
    b.head = head
    b.tail = head + UP
    b.roll = 0
    if parent:
        b.parent = arm_data.edit_bones[parent]
    return b


bone("body", Vector((0, 0, 0)))
bone("head", Vector((0, 0, NECK_Z)), "body")
bone("armL", Vector((-SHOULDER.x, 0, SHOULDER.z)), "body")
bone("armR", Vector((SHOULDER.x, 0, SHOULDER.z)), "body")
bone("legL", Vector((-HIP.x, 0, HIP.z)), "body")
bone("legR", Vector((HIP.x, 0, HIP.z)), "body")
bpy.ops.object.mode_set(mode="OBJECT")

# 4. weights by region, blended at the joints
groups = {n: obj.vertex_groups.new(name=n) for n in ("body", "head", "armL", "armR", "legL", "legR")}
for v in mesh.vertices:
    x, z = v.co.x, v.co.z
    ax = abs(x)
    side = "L" if x < 0 else "R"
    w = {}
    head = smoothstep(NECK_Z - 0.12, NECK_Z + 0.1, z)
    # arms: outside the torso's side, from the shoulder down to the hands (which end above the
    # legs: the feet are as wide as the arms, so height is what tells them apart); the shoulder cap blends
    arm = smoothstep(0.6, 0.72, ax) * smoothstep(SHOULDER.z + 0.2, SHOULDER.z - 0.12, z) * smoothstep(HANDS_Z - 0.1, HANDS_Z + 0.02, z) * (1 - head)
    # legs: below the hips, inside the torso's width; the seat blends into the body
    leg = smoothstep(HIP.z + 0.14, HIP.z - 0.2, z) * (1 - arm)
    rest = max(0.0, 1 - head - arm - leg)
    w["head"] = head
    w["arm" + side] = arm
    w["leg" + side] = leg
    w["body"] = rest
    total = sum(w.values()) or 1
    for n, k in w.items():
        if k > 1e-4:
            groups[n].add([v.index], k / total, "REPLACE")

obj.parent = rig
mod = obj.modifiers.new("Armature", "ARMATURE")
mod.object = rig

# 5. export
view.objects.active = rig
for o in scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_animations=False,
    export_yup=True,
    export_apply=False,
)
print(f"[guia] wrote {OUT}: {len(mesh.vertices)} vertices, {len(face_meshes)} face pieces")
if OUT_BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=True)
    print(f"[guia] saved {OUT_BLEND}")
