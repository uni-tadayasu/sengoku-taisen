#!/usr/bin/env python3
"""Build a 36-second vertical introduction from existing demo screenshots.

This is a screenshot presentation, not recorded gameplay. Source captures stay
unchanged. Only video layout, text, scaling, cropping and camera movement are used.
No external assets, paid APIs, account access or publication operations are used.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets' / 'promo'
BASENAME = 'sengoku-vs-first-steps-ja-20261126'
W, H, FPS, DURATION = 720, 1280, 24, 36
INK = (15, 30, 42)
PANEL = (24, 46, 60)
GOLD = (240, 209, 150)
WHITE = (248, 246, 235)
MUTED = (201, 217, 215)
FONT_DIR = Path('/usr/share/fonts/opentype/noto')
SERIF = FONT_DIR / 'NotoSerifCJK-Bold.ttc'
SANS = FONT_DIR / 'NotoSansCJK-Regular.ttc'
BOLD = FONT_DIR / 'NotoSansCJK-Bold.ttc'
MUSIC = ROOT / 'assets/music/world-march.mp3'
ICON = ROOT / 'assets/branding/sengoku-vs-icon-512-20261126.png'
NOTICE = 'ゲーム画面による紹介・撮影用デモ'
SCENES = [
    {'key':'opening','start':0,'seconds':4,'image':'assets/promo/screenshots/sengoku-vs-town-20261126.jpg','crop':[230,180,1000,750], 'title':'あなたの一城から。','lines':['町を育て、武将を率い、','次の城へ。']},
    {'key':'town','start':4,'seconds':8,'image':'assets/promo/screenshots/sengoku-vs-town-20261126.jpg','crop':[225,180,1005,765], 'title':'城下町を育てる','lines':['田畑や商家を育てて、','領国の土台をつくる。']},
    {'key':'officers','start':12,'seconds':8,'image':'assets/promo/screenshots/sengoku-vs-officers-20261126.jpg','crop':[239,240,1330,890], 'title':'武将を編成する','lines':['能力と役目を見比べ、','自分の軍団を整える。']},
    {'key':'map','start':20,'seconds':8,'image':'assets/promo/screenshots/sengoku-vs-map-20261126.jpg','crop':[235,404,1330,885], 'title':'地図から、合戦へ','lines':['隣の城と戦況を確認。','軍師の助言を読み、出陣。']},
    {'key':'start','start':28,'seconds':8,'image':'assets/promo/screenshots/sengoku-vs-town-20261126.jpg','crop':[225,180,1005,765], 'title':'一城から、始めよう。','lines':['基本プレイ無料','インストール不要']}
]

def font(path, size):
    return ImageFont.truetype(str(path), size)


def center(draw, text, y, face, fill=WHITE, max_width=600):
    box = draw.textbbox((0,0), text, font=face)
    width = box[2]-box[0]
    if width > max_width:
        raise ValueError(f'Text exceeds safe area: {text!r}, {width}px > {max_width}')
    draw.text(((W-width)/2-box[0],y-box[1]),text,font=face,fill=fill)


def base():
    frame=Image.new('RGB',(W,H),INK)
    draw=ImageDraw.Draw(frame)
    # Subtle bands form video framing, not an alteration of the screenshots.
    for y in range(H):
        shade=max(0,1-abs(y-480)/800)
        draw.line((0,y,W,y),fill=(15+int(6*shade),30+int(12*shade),42+int(13*shade)))
    draw.line((56,82,664,82),fill=GOLD,width=2)
    icon=Image.open(ICON).convert('RGBA').resize((48,48),Image.Resampling.LANCZOS)
    frame.paste(icon,(56,108),icon)
    draw.text((122,103),'戦国VS',font=font(SERIF,41),fill=GOLD)
    draw.text((454,119),'SENGOKU VS',font=font(BOLD,23),fill=GOLD)
    center(draw,NOTICE,1082,font(SANS,25),MUTED)
    center(draw,'© KASAI SOLUTIONS',1132,font(SANS,22),MUTED)
    return frame


BASE=base()
SOURCES={scene['image']:Image.open(ROOT/scene['image']).convert('RGB') for scene in SCENES}


def camera(scene, progress, width=608, height=510):
    image=SOURCES[scene['image']]
    left,top,right,bottom=scene['crop']
    # Retain the captured pixels, using only a viewport crop and slow camera move.
    # Wider screens use a wider crop first, then move toward the relevant panel.
    aspect=width/height
    crop_h=bottom-top
    crop_w=crop_h*aspect
    available_w=right-left
    if crop_w>available_w:
        crop_w=available_w
        crop_h=crop_w/aspect
    if scene['key']=='officers':
        x=left+(available_w-crop_w)*(.14+.66*progress)
    elif scene['key']=='map':
        x=left+(available_w-crop_w)*(.28+.22*progress)
    else:
        x=left+(available_w-crop_w)*(.35+.2*progress)
    y=top+((bottom-top)-crop_h)/2
    zoom=1+.025*progress
    view_w,view_h=crop_w/zoom,crop_h/zoom
    x+=(crop_w-view_w)/2
    y+=(crop_h-view_h)/2
    return image.transform((width,height),Image.Transform.AFFINE,(view_w/width,0,x,0,view_h/height,y),Image.Resampling.BICUBIC)


def scene_frame(index, local):
    scene=SCENES[index]
    p=min(1,max(0,local/scene['seconds']))
    frame=BASE.copy()
    draw=ImageDraw.Draw(frame)
    closing=scene['key']=='start'
    if closing:
        center(draw,scene['title'],224,font(SERIF,47),GOLD)
        center(draw,'基本プレイ無料',332,font(BOLD,55),GOLD)
        center(draw,'インストール不要',414,font(SANS,32))
        center(draw,'PC・スマホ・タブレット対応',469,font(SANS,28))
        draw.line((168,532,552,532),fill=(122,134,126),width=1)
        center(draw,'「城を選んで始める」',570,font(BOLD,33))
        center(draw,'ひとりで試すなら「端末だけで遊ぶ」',627,font(SANS,28))
        center(draw,'CPUとの個人戦役から試せます',686,font(SANS,27),MUTED)
        center(draw,'対人・同盟・交易は領主登録後',733,font(SANS,27),MUTED)
        draw.rounded_rectangle((98,820,622,898),radius=5,fill=GOLD)
        center(draw,'公式サイトで始める',843,font(BOLD,31),INK)
        center(draw,'www.kasai-solutions-inc.com',930,font(SANS,28))
        center(draw,'有料の外観アイテム・月額支援は任意',1001,font(SANS,25),MUTED)
    else:
        if index:
            center(draw,f'はじめての {index} 手目',198,font(BOLD,27),MUTED)
        else:
            center(draw,'戦国ブラウザ戦略ゲーム',198,font(BOLD,27),MUTED)
        center(draw,scene['title'],259,font(SERIF,53),GOLD)
        view=camera(scene,p)
        frame.paste(view,(56,352))
        draw.rectangle((55,351,664,862),outline=GOLD,width=2)
        for i,line in enumerate(scene['lines']):
            center(draw,line,912+51*i,font(SANS,33))
        if index:
            for step in range(3):
                x=288+step*48
                draw.rounded_rectangle((x,1035,x+32,1040),radius=2,fill=GOLD if step==index-1 else (83,107,113))
    return frame


def cue_time(seconds):
    return f'00:{seconds//60:02}:{seconds%60:02}.000'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--frames-only',action='store_true')
    parser.add_argument('--proofs-dir',type=Path,default=ROOT.parent/'qa-first-steps')
    parser.add_argument('--output',type=Path,default=DEST/(BASENAME+'.mp4'))
    opts=parser.parse_args()
    opts.proofs_dir.mkdir(parents=True,exist_ok=True)
    for index,scene in enumerate(SCENES):
        scene_frame(index,scene['seconds']/2).save(opts.proofs_dir/f'{BASENAME}-{scene["key"]}-proof.jpg',quality=93)
    if opts.frames_only:
        print(f'Five layout proofs: {opts.proofs_dir}')
        return
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise RuntimeError('FFmpeg and ffprobe are required.')
    opts.output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sengoku-steps-') as temp:
        encoded=Path(temp)/'encoded.mp4'
        args=['ffmpeg','-hide_banner','-loglevel','error','-y',
              '-f','rawvideo','-pixel_format','rgb24','-video_size',f'{W}x{H}','-framerate',str(FPS),'-i','pipe:0',
              '-i',str(MUSIC),'-map','0:v:0','-map','1:a:0',
              '-af','atrim=start=0:end=36,asetpts=PTS-STARTPTS,volume=0.88,afade=t=in:st=0:d=0.5,afade=t=out:st=34:d=2',
              '-c:v','libx264','-preset','medium','-crf','21','-maxrate','1800k','-bufsize','3600k','-threads','2',
              '-pix_fmt','yuv420p','-r',str(FPS),'-frames:v',str(DURATION*FPS),
              '-c:a','aac','-b:a','96k','-ar','44100','-ac','2','-t',str(DURATION),'-movflags','+faststart',
              '-map_metadata','-1','-metadata','title=戦国VS｜はじめての3手',
              '-metadata','artist=KASAI SOLUTIONS','-metadata','comment='+NOTICE+'。静止画を構成した動画であり、プレイ録画ではありません。',str(encoded)]
        encoder=subprocess.Popen(args,stdin=subprocess.PIPE)
        try:
            for n in range(DURATION*FPS):
                t=n/FPS
                index=max(i for i,s in enumerate(SCENES) if t>=s['start'])
                local=t-SCENES[index]['start']
                frame=scene_frame(index,local)
                if index and local<.3:
                    previous=scene_frame(index-1,SCENES[index-1]['seconds'])
                    frame=Image.blend(previous,frame,local/.3)
                # Keep the disclosure readable from the first to last frame;
                # video uses crossfades between scenes, with no black fade.
                encoder.stdin.write(frame.tobytes())
                if n%192==0: print(f'Rendering {n}/{DURATION*FPS}',file=sys.stderr)
        finally:
            encoder.stdin.close()
        if encoder.wait()!=0:raise RuntimeError('FFmpeg encoding failed.')
        shutil.copy2(encoded,opts.output)
    poster=opts.output.with_name(opts.output.stem+'-poster.jpg')
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-ss','6','-i',str(opts.output),'-frames:v','1','-q:v','2',str(poster)],check=True)
    cues=[
        (0,4,'戦国VS。あなたの一城から。\n町を育て、武将を率い、次の城へ。\nゲーム画面による紹介・撮影用デモ'),
        (4,12,'城下町を育てる。\n田畑や商家を育てて、領国の土台をつくる。'),
        (12,20,'武将を編成する。\n能力と役目を見比べ、自分の軍団を整える。'),
        (20,28,'地図から、合戦へ。隣の城と戦況を確認。\n軍師の助言を読み、出陣。'),
        (28,31,'基本プレイ無料。インストール不要。\nPC・スマホ・タブレット対応。'),
        (31,34,'「城を選んで始める」。\nひとりで試すなら「端末だけで遊ぶ」。\n対人・同盟・交易は領主登録後。'),
        (34,36,'有料の外観アイテム・月額支援は任意。\nwww.kasai-solutions-inc.com')
    ]
    transcript='WEBVTT\n\n'+''.join(f'{i+1}\n{cue_time(start)} --> {cue_time(end)}\n{text}\n\n' for i,(start,end,text) in enumerate(cues))
    opts.output.with_suffix('.vtt').write_text(transcript)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(opts.output)]))
    video=next(s for s in probe['streams'] if s['codec_type']=='video')
    audio=next(s for s in probe['streams'] if s['codec_type']=='audio')
    paths=sorted(set(s['image'] for s in SCENES)|{str(MUSIC.relative_to(ROOT)),str(ICON.relative_to(ROOT))})
    summary={'file':opts.output.name,'createdDate':'2026-11-26','title':'戦国VS｜はじめての3手','seconds':float(probe['format']['duration']),
             'bytes':opts.output.stat().st_size,'sha256':hashlib.sha256(opts.output.read_bytes()).hexdigest(),
             'video':{key:video.get(key) for key in ('codec_name','width','height','pix_fmt','r_frame_rate','nb_frames')},
             'audio':{key:audio.get(key) for key in ('codec_name','sample_rate','channels')},
             'notice':NOTICE,'presentationType':'Animated presentation of existing screenshot crops. Not a gameplay recording.',
             'captureManifest':'assets/promo/screenshots/manifest.json','captureVersions':{'town':'5.1.0','officers':'5.0.5','map':'5.0.5'},
             'music':{'path':str(MUSIC.relative_to(ROOT)),'title':'旌旗越ゆる稜線','usage':'first 36 seconds, volume 0.88, fade in 0.5 seconds / fade out 2 seconds','provenance':['ARTWORK.md','assets/music/masters.json','music.js','tools/render-soundtrack.py']},
             'sources':[{'path':path,'sha256':hashlib.sha256((ROOT/path).read_bytes()).hexdigest()} for path in paths],
             'scenes':SCENES,'sourceImagesUnchanged':True,'narration':False,'externalAssetsAdded':False}
    if summary['seconds']!=DURATION or summary['bytes']>=10_000_000:raise RuntimeError('Unexpected duration or video over 10 MB.')
    if video['codec_name']!='h264' or video['pix_fmt']!='yuv420p':raise RuntimeError('Unexpected video codec.')
    opts.output.with_suffix('.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({key:summary[key] for key in ('file','seconds','bytes','sha256','video','audio')},ensure_ascii=False,indent=2))

if __name__=='__main__':main()
