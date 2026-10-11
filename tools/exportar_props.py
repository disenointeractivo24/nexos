"""
Street props from Substance Painter -> GLB for the experience (Blender 4.2+ / 5.x, in the background):

    blender -b --factory-startup --python tools/exportar_props.py -- <fuentes_3d/props> <static/assets/props> [preview_dir]

Each prop has its own folder in fuentes_3d/props/: the model in GLB/ and the textures
Substance exported, named <prefix>_<material>_<Map>.jpg. For every prop the script:

- puts each material's BaseColor on it, matte (the other maps are not used: the look is
  the colour as painted, like the guide and the city ground);
- when a material has no texture of its own name but the prop has just one texture
  set left (Substance renamed it, e.g. "Material.003"), uses that one;
- sets the prop on the ground at the origin (the files come placed somewhere in the
  scene) and writes static/assets/props/<slug>.glb.

The app (src/data/assets.js) scales and turns each one.
"""

import glob
import os
import re
import sys
import unicodedata

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = (os.path.abspath(a) for a in args[:2])
PREVIEW = os.path.abspath(args[2]) if len(args) > 2 else None
MATTE_ROUGHNESS = 0.95


def slug(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def base_colors(folder):
    """material name (lower case) -> BaseColor path, from <prefix>_<material>_BaseColor.jpg"""
    out = {}
    for p in glob.glob(os.path.join(folder, "*_BaseColor.*")):
        stem = os.path.basename(p).rsplit("_BaseColor", 1)[0]
        prefix, _, material = stem.partition("_")
        out[material.lower()] = p
    return out


os.makedirs(OUT, exist_ok=True)
for folder in sorted(d for d in glob.glob(os.path.join(SRC, "*")) if os.path.isdir(d)):
    glbs = glob.glob(os.path.join(folder, "GLB", "*.glb")) + glob.glob(os.path.join(folder, "*.glb"))
    if not glbs:
        continue
    name = os.path.basename(folder)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glbs[0])
    textures = base_colors(folder)
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    materials = {m for o in meshes for m in o.data.materials if m}
    unused = dict(textures)
    for m in materials:
        unused.pop(m.name.lower(), None)
    for m in sorted(materials, key=lambda m: m.name):
        path = textures.get(m.name.lower())
        if not path and len(unused) == 1:
            path = next(iter(unused.values()))
        if not path:
            print(f"[props] {name}: {m.name} has no BaseColor, kept as it is")
            continue
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF") or nt.nodes.new("ShaderNodeBsdfPrincipled")
        for link in list(nt.links):
            if link.to_node == bsdf:
                nt.links.remove(link)
        img = nt.nodes.new("ShaderNodeTexImage")
        img.image = bpy.data.images.load(path, check_existing=True)
        nt.links.new(img.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = MATTE_ROUGHNESS
        bsdf.inputs["Metallic"].default_value = 0
        if "Specular IOR Level" in bsdf.inputs:
            bsdf.inputs["Specular IOR Level"].default_value = 0.2
        print(f"[props] {name}: {m.name} <- {os.path.basename(path)}")

    # on the ground, centred at the origin
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    shift = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    for o in bpy.data.objects:
        if o.parent is None:
            o.location -= shift
    size = mx - mn
    out = os.path.join(OUT, f"{slug(name)}.glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_apply=True)
    print(f"[props] wrote {out}: {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m (width x depth x height in Blender)")

    if PREVIEW:
        scene = bpy.context.scene
        scene.render.engine = "BLENDER_WORKBENCH"
        scene.display.shading.light = "STUDIO"
        scene.display.shading.color_type = "TEXTURE"
        scene.render.resolution_x = scene.render.resolution_y = 360
        cam = bpy.data.objects.new("C", bpy.data.cameras.new("C"))
        scene.collection.objects.link(cam)
        scene.camera = cam
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = max(size) * 1.3
        c = Vector((0, 0, size.z / 2))
        cam.location = c + Vector((0.6, -1.0, 0.45)).normalized() * 20
        cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW, f"{slug(name)}.png")
        bpy.ops.render.render(write_still=True)
