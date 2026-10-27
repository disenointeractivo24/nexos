"""
A lighter copy of a GLB for things seen from far away (Blender 4.2+ / 5.x, in the background):

    blender -b --factory-startup --python tools/decimar_glb.py -- <in.glb> <out.glb> [ratio] [texture px]

Each mesh keeps `ratio` of its triangles (0.25 by default), collapsed so its UVs and textures
still fit; the textures are scaled down to `texture px` (256 by default), which is all a tree on
a hillside a kilometre away needs. Used for the city's hillside forest (see fuentes_3d/LEEME.md).
"""

import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = (os.path.abspath(a) for a in args[:2])
RATIO = float(args[2]) if len(args) > 2 else 0.25
TEX = int(args[3]) if len(args) > 3 else 256

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

before = after = 0
for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
    before += sum(len(p.vertices) - 2 for p in o.data.polygons)
    mod = o.modifiers.new("decimar", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = RATIO
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after += len(o.data.polygons)

for img in bpy.data.images:
    w, h = img.size
    if max(w, h) > TEX:
        k = TEX / max(w, h)
        img.scale(max(1, round(w * k)), max(1, round(h * k)))
        # write the smaller picture into the file, not the original
        img.pack()

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_yup=True,
    export_apply=True,
    export_image_format="JPEG",
    export_materials="EXPORT",
    export_normals=True,
    export_tangents=False,
)
print(f"[lejos] {OUT}: {before} -> {after} triángulos, texturas de {TEX} px, {os.path.getsize(OUT) / 1e3:.0f} KB")
