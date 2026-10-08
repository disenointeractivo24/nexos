"""
FBX/GLB + Substance textures -> GLB for the experience (Blender 4.2+ / 5.x, run in the background):

    blender -b --factory-startup --python tools/fbx_to_glb.py -- <model.fbx|.glb> <textures_dir> <out.glb> [prefix]

The sources live in fuentes_3d/<casa>/ (model + texturas/); the result goes to
static/assets/houses/ (see fuentes_3d/LEEME.md).

Textures are matched to materials by name, the way Substance Painter exports them:
    <prefix>_<material>_<Map>.png|.jpg   e.g. Casa1_prueba_Paredes_BaseColor.png
The prefix defaults to the model's file name (Casa1_prueba.fbx -> Casa1_prueba).
Maps used: BaseColor, Normal (OpenGL), Roughness, Metallic, Emissive (only if it is not black).
Height is not part of glTF and is skipped.

To keep the experience fast, the parts that share a material are merged into one
mesh (a tiled roof of 54 pieces becomes one), and a part with no material gets
a plain glass material.
"""

import os
import sys

import bpy

args = sys.argv[sys.argv.index("--") + 1:]
FBX, TEX_DIR, OUT = (os.path.abspath(a) for a in args[:3])
STEM = args[3] if len(args) > 3 else os.path.splitext(os.path.basename(FBX))[0]


def texture(material, kind):
    # Substance exports PNG or JPEG, depending on the preset
    for ext in ("png", "jpg", "jpeg"):
        path = os.path.join(TEX_DIR, f"{STEM}_{material}_{kind}.{ext}")
        if os.path.exists(path):
            return path
    return None


def is_flat(img, threshold=0.01):
    """True when an image is a single value (Substance exports constant maps as tiny files)."""
    px = img.pixels[:]
    step = max(4, (len(px) // 4 // 4096) * 4)  # sample ~4096 pixels
    r = px[0:len(px):step]
    return max(r) - min(r) < threshold, (sum(r) / len(r)) if r else 0


def image_node(nt, path, colour, x, y):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(path, check_existing=True)
    n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    n.location = (x, y)
    return n


def build_material(mat):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    found = []
    if p := texture(mat.name, "BaseColor"):
        nt.links.new(image_node(nt, p, True, -500, 300).outputs["Color"], bsdf.inputs["Base Color"])
        found.append("BaseColor")
    for kind, socket in (("Roughness", "Roughness"), ("Metallic", "Metallic")):
        if p := texture(mat.name, kind):
            node = image_node(nt, p, False, -500, 0 if kind == "Roughness" else -250)
            flat, value = is_flat(node.image)
            if flat:
                bsdf.inputs[socket].default_value = value
                nt.nodes.remove(node)
                found.append(f"{kind}={value:.2f}")
            else:
                nt.links.new(node.outputs["Color"], bsdf.inputs[socket])
                found.append(kind)
    if p := texture(mat.name, "Normal"):
        img = image_node(nt, p, False, -700, -500)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.location = (-250, -500)
        nt.links.new(img.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        found.append("Normal")
    if p := texture(mat.name, "Emissive"):
        node = image_node(nt, p, True, -500, -750)
        flat, value = is_flat(node.image)
        if flat and value < 0.01:
            nt.nodes.remove(node)
        else:
            nt.links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
            found.append("Emissive")
    return found


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if FBX.lower().endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=FBX)
    else:
        bpy.ops.import_scene.fbx(filepath=FBX)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

    glass = bpy.data.materials.new("Vidrio")
    glass.use_nodes = True
    g = glass.node_tree.nodes.get("Principled BSDF")
    g.inputs["Base Color"].default_value = (0.09, 0.15, 0.21, 1)
    g.inputs["Roughness"].default_value = 0.25
    for o in meshes:
        if not o.data.materials:
            o.data.materials.append(glass)
            print(f"[glb] {o.name}: sin material -> Vidrio")

    for mat in bpy.data.materials:
        if mat is glass:
            continue
        print(f"[glb] material {mat.name!r}: {', '.join(build_material(mat)) or 'sin texturas'}")

    # one mesh per material: fewer draw calls in the browser
    for o in meshes:
        o.select_set(False)
    by_mat = {}
    for o in meshes:
        by_mat.setdefault(o.data.materials[0].name, []).append(o)
    for name, objs in by_mat.items():
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if len(objs) > 1:
            bpy.ops.object.join()
        bpy.context.view_layer.objects.active.name = name
    for o in [o for o in bpy.context.scene.objects if o.type == "EMPTY"]:
        bpy.data.objects.remove(o)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_image_format="AUTO",
        export_materials="EXPORT",
        export_normals=True,
        export_tangents=True,
    )
    print(f"[glb] escrito {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB), {len(by_mat)} mallas")


main()
