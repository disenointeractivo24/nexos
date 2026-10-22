# Turns the opening act's frames (see apertura.js) into an MP4 (H.264, which every browser plays),
# with the FFmpeg inside Blender: no separate install.
#   blender -b --factory-startup --python tools/apertura/codificar.py -- <frames folder> <prefix> <out.mp4> [fps]
import os
import sys

import bpy

frames_dir, prefix, out = sys.argv[sys.argv.index("--") + 1:][:3]
rest = sys.argv[sys.argv.index("--") + 4:]
fps = int(rest[0]) if rest else 60

files = sorted(f for f in os.listdir(frames_dir) if f.startswith(prefix) and f.endswith(".png"))
if not files:
    raise SystemExit(f"no hay cuadros {prefix}* en {frames_dir}")

scene = bpy.context.scene
first = bpy.data.images.load(os.path.join(frames_dir, files[0]))
w, h = first.size
scene.render.resolution_x = w
scene.render.resolution_y = h
scene.render.resolution_percentage = 100
scene.render.fps = fps
scene.frame_start = 1
scene.frame_end = len(files)
# the frames are already the final picture: no colour transform on the way out
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.view_settings.exposure = 0
scene.view_settings.gamma = 1

seq = scene.sequence_editor_create()
strips = seq.strips if hasattr(seq, "strips") else seq.sequences
strip = strips.new_image("frames", os.path.join(frames_dir, files[0]), 1, 1)
for f in files[1:]:
    strip.elements.append(f)
strip.frame_final_duration = len(files)

r = scene.render
r.use_sequencer = True
# Blender 5 sets video apart from still images
if hasattr(r.image_settings, "media_type"):
    r.image_settings.media_type = "VIDEO"
r.image_settings.file_format = "FFMPEG"
r.ffmpeg.format = "MPEG4"
r.ffmpeg.codec = "H264"
r.ffmpeg.constant_rate_factor = "HIGH"
r.ffmpeg.ffmpeg_preset = "BEST"
# a keyframe every half second: the browser can start and loop it cleanly
r.ffmpeg.gopsize = fps // 2
r.ffmpeg.audio_codec = "NONE"
r.filepath = os.path.abspath(out)
r.use_file_extension = False
bpy.ops.render.render(animation=True)
print(f"[apertura] escrito {out}: {len(files)} cuadros a {fps} fps, {w}x{h}")
