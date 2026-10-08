"""
Model export, step 2 of 2 (Blender 4.2+ / 5.x, run in the background):

    blender -b --factory-startup --python tools/export-models/build_fbx.py -- <in_dir> <out_dir>

Reads the models written by the receiver (tools/export-models/out) and, for each:
  * builds its node tree (empties for groups, quad meshes for parts) with the
    same names, transforms and materials as in the experience;
  * converts three.js axes (Y up, model front +Z) to Blender's (Z up, front -Y);
  * exports <out_dir>/<category>/<name>.fbx with its textures embedded.
Then it re-imports every FBX to check that all polygons are quads, writes
<out_dir>/informe.txt, and renders <out_dir>/vista_previa.png (one tile per model).
"""

import json
import math
import os
import shutil
import sys

import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
IN_DIR = os.path.abspath(argv[0] if argv else "tools/export-models/out")
OUT_DIR = os.path.abspath(argv[1] if len(argv) > 1 else "modelos_fbx")
TEX_DIR = os.path.join(IN_DIR, "textures")

# three.js (x, y, z) -> Blender (x, -z, y)
C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
C_INV = C.inverted()


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h):
    h = h.lstrip("#")
    return [srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0


def make_material(m):
    mat = bpy.data.materials.get(m["name"])
    if mat:
        return mat
    mat = bpy.data.materials.new(m["name"])
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    rgb = hex_rgb(m["color"])
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = float(m["roughness"])
    bsdf.inputs["Metallic"].default_value = float(m["metalness"])
    mat.diffuse_color = (*rgb, m["opacity"])  # viewport colour
    mat.roughness = float(m["roughness"])
    mat.metallic = float(m["metalness"])
    if m["emissiveIntensity"] and m["emissive"] != "#000000":
        bsdf.inputs["Emission Color"].default_value = (*hex_rgb(m["emissive"]), 1.0)
        bsdf.inputs["Emission Strength"].default_value = float(m["emissiveIntensity"])
    if m["texture"]:
        path = os.path.join(TEX_DIR, m["texture"])
        img = bpy.data.images.load(path, check_existing=True)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.location = (-420, 260)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if m["opacity"] >= 1 and m["name"].endswith("emblema"):
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    if m["opacity"] < 1:
        bsdf.inputs["Alpha"].default_value = float(m["opacity"])
    if m["opacity"] < 1 or (m["texture"] and m["name"].endswith("emblema")):
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
    mat.use_backface_culling = not m["doubleSided"]
    return mat


def make_mesh(name, data, materials):
    p = data["positions"]
    verts = [(p[i], -p[i + 2], p[i + 1]) for i in range(0, len(p), 3)]
    f = data["faces"]
    faces = [tuple(f[i:i + 4]) for i in range(0, len(f), 4)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uv_layer = me.uv_layers.new(name="UVMap")
    uvs = data["uvs"]
    for poly in me.polygons:
        for k, li in enumerate(poly.loop_indices):
            uv_layer.data[li].uv = (uvs[poly.index * 8 + k * 2], uvs[poly.index * 8 + k * 2 + 1])
    for mi in data["materials"]:
        me.materials.append(materials[mi])
    mats = data["mats"]
    for poly in me.polygons:
        poly.material_index = min(mats[poly.index], len(data["materials"]) - 1)
    if data["smooth"]:
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(40))
    else:
        me.shade_flat()
    me.validate(clean_customdata=False)
    me.update()
    return me


def build_node(node, model, materials, parent=None):
    if "mesh" in node:
        obj = bpy.data.objects.new(node["name"], make_mesh(node["name"], model["meshes"][node["mesh"]], materials))
    else:
        obj = bpy.data.objects.new(node["name"], None)
        obj.empty_display_type = "PLAIN_AXES"
        obj.empty_display_size = 0.1
    bpy.context.scene.collection.objects.link(obj)
    m = node["matrix"]  # three.js stores matrices column by column
    local = C @ Matrix([[m[c * 4 + r] for c in range(4)] for r in range(4)]) @ C_INV
    obj.parent = parent
    obj.matrix_basis = local
    for child in node["children"]:
        build_node(child, model, materials, obj)
    return obj


def export_model(json_path):
    with open(json_path, encoding="utf-8") as fh:
        model = json.load(fh)
    reset_scene()
    materials = [make_material(m) for m in model["materials"]]
    build_node(model["root"], model, materials)
    out_dir = os.path.join(OUT_DIR, model["category"])
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, model["name"] + ".fbx")
    bpy.ops.export_scene.fbx(
        filepath=out,
        use_selection=False,
        object_types={"EMPTY", "MESH"},
        use_mesh_modifiers=False,
        mesh_smooth_type="FACE",
        use_tspace=False,
        add_leaf_bones=False,
        path_mode="COPY",
        embed_textures=True,
        axis_forward="-Z",
        axis_up="Y",
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS",
        bake_space_transform=False,
    )
    return model, out


def check_fbx(path):
    reset_scene()
    bpy.ops.import_scene.fbx(filepath=path)
    quads = other = 0
    tris = 0
    ngons = 0
    meshes = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        meshes += 1
        for poly in obj.data.polygons:
            n = poly.loop_total
            if n == 4:
                quads += 1
            else:
                other += 1
                if n == 3:
                    tris += 1
                else:
                    ngons += 1
    return {"meshes": meshes, "quads": quads, "tris": tris, "ngons": ngons}


def render_preview(path, png):
    reset_scene()
    bpy.ops.import_scene.fbx(filepath=path)
    scene = bpy.context.scene
    objs = [o for o in scene.objects if o.type == "MESH"]
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    centre = (lo + hi) / 2
    size = max((hi - lo).length, 1e-3)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.05
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    direction = Vector((0.75, -1.0, 0.62)).normalized()
    cam.location = centre + direction * size * 3
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    cam_data.clip_end = size * 10
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_cavity = True
    scene.display.shading.show_object_outline = True
    scene.render.film_transparent = False
    if hasattr(scene.display.shading, "background_type"):
        scene.display.shading.background_type = "WORLD"
    scene.render.resolution_x = scene.render.resolution_y = 300
    scene.render.filepath = png
    world = bpy.data.worlds.new("w")
    world.color = (0.93, 0.95, 0.96)
    scene.world = world
    bpy.ops.render.render(write_still=True)


def contact_sheet(pngs, out_png, cols=7, cell=300):
    import numpy as np

    rows = math.ceil(len(pngs) / cols)
    sheet = np.ones((rows * cell, cols * cell, 4), dtype=np.float32)
    for i, p in enumerate(pngs):
        img = bpy.data.images.load(p)
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
        r, c = divmod(i, cols)
        # Blender image rows go bottom-up; place tiles top-down
        y0 = (rows - 1 - r) * cell
        sheet[y0:y0 + min(h, cell), c * cell:c * cell + min(w, cell)] = px[:cell, :cell]
        bpy.data.images.remove(img)
    out = bpy.data.images.new("sheet", cols * cell, rows * cell, alpha=True)
    out.pixels = sheet.ravel()
    out.filepath_raw = out_png
    out.file_format = "PNG"
    out.save()


def main():
    jsons = []
    for root, _, files in os.walk(IN_DIR):
        for f in files:
            if f.endswith(".json"):
                jsons.append(os.path.join(root, f))
    order = ["personajes", "insumos", "punto_de_acopio", "vegetacion", "barrio", "ciudad", "emergencias"]
    jsons.sort(key=lambda p: (order.index(os.path.basename(os.path.dirname(p))) if os.path.basename(os.path.dirname(p)) in order else 99, p))

    os.makedirs(OUT_DIR, exist_ok=True)
    tex_out = os.path.join(OUT_DIR, "texturas")
    os.makedirs(tex_out, exist_ok=True)
    for f in os.listdir(TEX_DIR):
        shutil.copy2(os.path.join(TEX_DIR, f), os.path.join(tex_out, f))

    exported = []
    for j in jsons:
        model, path = export_model(j)
        exported.append((model, path))
        print(f"[fbx] {model['category']}/{model['name']}")

    lines = ["Informe de exportación FBX — NEXOS", "", "categoría/modelo: mallas, quads, triángulos, n-gonos", ""]
    total_bad = 0
    preview_dir = os.path.join(IN_DIR, "previews")
    os.makedirs(preview_dir, exist_ok=True)
    pngs = []
    for model, path in exported:
        r = check_fbx(path)
        total_bad += r["tris"] + r["ngons"]
        lines.append(f"{model['category']}/{model['name']}: {r['meshes']} mallas, {r['quads']} quads, {r['tris']} triángulos, {r['ngons']} n-gonos")
        png = os.path.join(preview_dir, f"{len(pngs):02d}_{model['name']}.png")
        render_preview(path, png)
        pngs.append(png)
    lines += ["", f"Modelos: {len(exported)}", f"Polígonos que no son quads: {total_bad}"]
    with open(os.path.join(OUT_DIR, "informe.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    contact_sheet(pngs, os.path.join(OUT_DIR, "vista_previa.png"))
    print("\n".join(lines))


main()
