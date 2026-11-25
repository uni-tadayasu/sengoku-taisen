#!/usr/bin/env python3
"""Build the 24-second Japanese vertical introduction from repository artwork.

Requires ffmpeg, ffprobe, Pillow and Noto CJK fonts (Debian paths by default).
Run: python3 tools/build-promo-video.py
Options: --frames-only (layout proof), --output /absolute/path.mp4
The imagery is an editorial crop of official illustrations, not gameplay.
No account, publishing operation, external download or generative API is used.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets' / 'promo'
EDITION = '20261126'
BASENAME = f'sengoku-vs-intro-ja-{EDITION}'
W, H, FPS = 720, 1280, 24
DURATION = 24
INK = (15, 23, 31)
GOLD = (238, 206, 143)
WHITE = (248, 245, 236)
FONT_DIR = Path('/usr/share/fonts/opentype/noto')
SERIF = FONT_DIR / 'NotoSerifCJK-Bold.ttc'
SANS = FONT_DIR / 'NotoSansCJK-Regular.ttc'
SANS_BOLD = FONT_DIR / 'NotoSansCJK-Bold.ttc'
MUSIC = ROOT / 'assets' / 'music' / 'world-march.mp3'
ICON = ROOT / 'assets' / 'branding' / f'sengoku-vs-icon-512-{EDITION}.png'
SCENES = [
    {'key': 'title', 'image': 'assets/chronicle/cover.webp', 'focus': (.77, .30), 'seconds': 4.4, 'title': '戦国VS', 'lines': ['一城から、天下へ。'], 'zoom': 'in'},
    {'key': 'town', 'image': 'assets/chronicle/town.webp', 'focus': (.30, .45), 'seconds': 4.4, 'title': '城下町を育てる', 'lines': ['施設を整え、', '自分の領国を豊かに。'], 'zoom': 'out'},
    {'key': 'officers', 'image': 'assets/chronicle/war.webp', 'focus': (.64, .12), 'seconds': 4.4, 'title': '武将を編成する', 'lines': ['役目と戦法を選び、', '自分の軍団をつくる。'], 'zoom': 'in'},
    {'key': 'siege', 'image': 'assets/chronicle/cover.webp', 'focus': (.03, .52), 'seconds': 4.4, 'title': '城を攻める', 'lines': ['次の一城へ、', 'あなたの采配を。'], 'zoom': 'out'},
    {'key': 'start', 'image': 'assets/chronicle/cover.webp', 'focus': (.76, .30), 'seconds': 8, 'title': '戦国VS', 'lines': ['基本プレイ無料', 'インストール不要', 'PC・スマホ・タブレット対応'], 'zoom': 'in'},
]


def font(path, size):
    return ImageFont.truetype(str(path), size)


def centered(draw, text, y, face, fill=WHITE):
    box = draw.textbbox((0, 0), text, font=face)
    width = box[2] - box[0]
    if width > 608:
        raise ValueError(f'Text exceeds 608 px safe width: {text!r} ({width}px)')
    draw.text(((W-width)/2-box[0], y-box[1]), text, font=face, fill=fill)


def background(scene, folder):
    with Image.open(ROOT / scene['image']) as raw:
        # High-resolution canvas makes the slow crop/zoom smooth. Aspect ratios
        # are preserved; images are never stretched or redrawn.
        frame = ImageOps.fit(raw.convert('RGB'), (W*2, H*2), Image.Resampling.LANCZOS, centering=scene['focus'])
    path = folder / f'{scene["key"]}-art.png'
    frame.save(path, compress_level=2)
    return path


def overlay(scene, folder):
    frame = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(frame)
    closing = scene['key'] == 'start'
    # A restrained dark veil puts high-contrast lettering over an art still.
    # It is part of the video layout and does not change the source artwork.
    for y in range(H):
        if closing:
            alpha = 192 if y < 330 else min(250, 192+int((y-330)*.12))
        else:
            top = max(0, 1-y/330)*138
            bottom = max(0, min(1, (y-570)/310))*246
            alpha = max(10, int(top), int(bottom))
        draw.line((0, y, W, y), fill=(*INK, alpha))
    # Small masthead stays within common vertical-video text-safe margins.
    icon = Image.open(ICON).convert('RGBA').resize((44,44), Image.Resampling.LANCZOS)
    frame.alpha_composite(icon, (56, 105))
    draw.text((114, 111), 'SENGOKU VS', font=font(SANS_BOLD, 25), fill=GOLD)
    draw.text((56, 171), '戦国戦略シミュレーション', font=font(SANS, 25), fill=WHITE)
    if closing:
        large_icon = Image.open(ICON).convert('RGBA').resize((100,100), Image.Resampling.LANCZOS)
        frame.alpha_composite(large_icon, (310, 235))
        centered(draw, '戦国VS', 374, font(SERIF, 108), GOLD)
        centered(draw, '一城から、天下へ。', 520, font(SERIF, 43))
        draw.line((294, 599, 426, 599), fill=(*GOLD, 190), width=2)
        centered(draw, '基本プレイ無料', 636, font(SANS_BOLD, 46), GOLD)
        centered(draw, 'インストール不要', 712, font(SANS, 32))
        centered(draw, 'PC・スマホ・タブレット対応', 763, font(SANS, 28))
        draw.rounded_rectangle((118, 830, 602, 904), radius=9, fill=(*GOLD, 255))
        centered(draw, '公式サイトで始める', 849, font(SANS_BOLD, 32), (*INK, 255))
        centered(draw, 'www.kasai-solutions-inc.com', 939, font(SANS, 28))
        centered(draw, '有料の外観アイテム・月額支援あり', 1000, font(SANS, 24), (219,224,228,255))
    elif scene['key'] == 'title':
        centered(draw, '戦国VS', 780, font(SERIF, 112), GOLD)
        draw.line((282, 938, 438, 938), fill=(*GOLD, 190), width=2)
        centered(draw, '一城から、天下へ。', 969, font(SERIF, 46))
    else:
        centered(draw, scene['title'], 804, font(SERIF, 58), GOLD)
        draw.line((282, 894, 438, 894), fill=(*GOLD, 190), width=2)
        for index, line in enumerate(scene['lines']):
            centered(draw, line, 932 + index*53, font(SANS, 34))
    centered(draw, '公式イラストによる紹介', 1065, font(SANS, 24), (216,222,226,255))
    path = folder / f'{scene["key"]}-overlay.png'
    frame.save(path, compress_level=2)
    return path


def run(args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frames-only', action='store_true')
    parser.add_argument('--output', type=Path, default=DEST / f'{BASENAME}.mp4')
    parser.add_argument('--proofs-dir', type=Path, default=ROOT.parent / 'qa-promo')
    opts = parser.parse_args()
    for command in ('ffmpeg', 'ffprobe'):
        if not shutil.which(command):
            raise SystemExit(f'{command} is required.')
    for path in (SERIF, SANS, SANS_BOLD, MUSIC, ICON):
        if not path.exists():
            raise SystemExit(f'Required source is missing: {path}')
    DEST.mkdir(parents=True, exist_ok=True)
    if opts.frames_only: opts.proofs_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sengoku-promo-') as tmp:
        folder = Path(tmp)
        art_frames = []
        text_layers = []
        for scene in SCENES:
            art = background(scene, folder)
            layer = overlay(scene, folder)
            art_frames.append(Image.open(art).convert('RGB'))
            text_layers.append(Image.open(layer).convert('RGBA'))
            if opts.frames_only:
                still = art_frames[-1].resize((W,H), Image.Resampling.LANCZOS).convert('RGBA')
                still.alpha_composite(text_layers[-1])
                still.convert('RGB').save(opts.proofs_dir / f'{BASENAME}-{scene["key"]}-proof.jpg', quality=92)
        if opts.frames_only:
            print(f'Five layout proofs saved in {opts.proofs_dir}.')
            return

        def scene_frame(index, local_time):
            scene = SCENES[index]
            progress = min(1.0, max(0.0, local_time / scene['seconds']))
            zoom = 1 + .055 * (progress if scene['zoom']=='in' else 1-progress)
            original = art_frames[index]
            crop_w, crop_h = original.width/zoom, original.height/zoom
            left, top = (original.width-crop_w)/2, (original.height-crop_h)/2
            frame = original.transform((W,H), Image.Transform.AFFINE,
                (crop_w/W,0,left,0,crop_h/H,top), Image.Resampling.BICUBIC).convert('RGBA')
            frame.alpha_composite(text_layers[index])
            return frame.convert('RGB')

        encoded = folder / 'encoded.mp4'
        args=['ffmpeg','-hide_banner','-loglevel','error','-y',
              '-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}',
              '-framerate',str(FPS),'-i','pipe:0','-i',str(MUSIC),
              '-map','0:v:0','-map','1:a:0',
              '-af','atrim=start=0:end=24,asetpts=PTS-STARTPTS,volume=0.82,afade=t=in:st=0:d=0.6,afade=t=out:st=22.4:d=1.6',
              '-c:v','libx264','-preset','slow','-crf','22','-maxrate','1650k','-bufsize','3300k',
              '-threads','2','-pix_fmt','yuv420p','-r',str(FPS),'-frames:v',str(DURATION*FPS),
              '-c:a','aac','-b:a','96k','-ar','44100','-ac','2','-t',str(DURATION),'-movflags','+faststart',
              '-map_metadata','-1','-metadata','title=戦国VS｜一城から、天下へ。',
              '-metadata','artist=KASAI SOLUTIONS','-metadata','comment=公式イラストによるゲーム紹介。実プレイ映像ではありません。',
              str(encoded)]
        encoder=subprocess.Popen(args,stdin=subprocess.PIPE)
        black=Image.new('RGB',(W,H),INK)
        try:
            for n in range(DURATION*FPS):
                t=n/FPS
                current=min(int(t//4),4)
                local=t-current*4
                frame=scene_frame(current,local)
                if current>0 and local<.4:
                    previous=scene_frame(current-1,4+local)
                    frame=Image.blend(previous,frame,local/.4)
                fade=min(1.0,t/.3,max(0.0,(24-t)/.8))
                if fade<1:frame=Image.blend(black,frame,fade)
                encoder.stdin.write(frame.tobytes())
                if n%96==0:print(f'Rendering frame {n}/{DURATION*FPS}',file=sys.stderr)
        finally:
            encoder.stdin.close()
        if encoder.wait()!=0:
            raise RuntimeError('FFmpeg could not finish the video.')
        opts.output.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(encoded,opts.output)
        # A clean closing frame is useful for a native HTML video poster.
        poster=opts.output.with_name(f'{opts.output.stem}-poster.jpg')
        run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss','20','-i',str(opts.output),'-frames:v','1','-q:v','2',str(poster)])
    probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(opts.output)]))
    summary = {'file':opts.output.name,'seconds':float(probe['format']['duration']),'bytes':opts.output.stat().st_size,
               'sha256':hashlib.sha256(opts.output.read_bytes()).hexdigest(),
               'video':next({key:stream.get(key) for key in ('codec_name','width','height','pix_fmt','r_frame_rate','nb_frames')} for stream in probe['streams'] if stream['codec_type']=='video'),
               'audio':next({key:stream.get(key) for key in ('codec_name','sample_rate','channels')} for stream in probe['streams'] if stream['codec_type']=='audio'),
               'illustration_notice':'公式イラストによる紹介',
               'music':{'path':'assets/music/world-march.mp3','title':'旌旗越ゆる稜線','usage':'first 24 seconds, volume ×0.82, fade in 0.6 s / fade out 1.6 s','provenance':['ARTWORK.md','assets/music/masters.json','music.js','tools/render-soundtrack.py']},
               'sources':[{'path':source,'sha256':hashlib.sha256((ROOT/source).read_bytes()).hexdigest()} for source in sorted({scene['image'] for scene in SCENES}|{str(ICON.relative_to(ROOT)),str(MUSIC.relative_to(ROOT))})],
               'scenes':SCENES}
    if summary['video']['codec_name'] != 'h264' or summary['video']['pix_fmt'] != 'yuv420p':
        raise RuntimeError('Unexpected video format.')
    if abs(summary['seconds'] - DURATION) > 0.05 or summary['bytes'] > 6_000_000:
        raise RuntimeError('The video must be 24 seconds and smaller than 6 MB.')
    opts.output.with_name(f'{opts.output.stem}.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary,ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
