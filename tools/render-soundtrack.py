"""Render the 16 game scores using FluidSynth, TimGM6mb, NumPy, SciPy and FFmpeg.

Run from any directory: python3 tools/render-soundtrack.py
Set SENGOKU_SOUNDFONT to select a local General MIDI SoundFont.
"""
from __future__ import annotations

import ctypes as C
import ctypes.util
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import sosfilt, butter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets/music"
RATE = 44100
SOUNDFONT = os.environ.get("SENGOKU_SOUNDFONT", "/usr/share/sounds/sf2/TimGM6mb.sf2")

# GM soloist, answering instrument, bowed harmony, plucked accompaniment,
# low register. Orchestrate every cue independently of the polyphonic player.
CHAIRS = {
    'town-dawn': (77, 107, 49, 107, 42), 'castle-evening': (42, 73, 49, 46, 43),
    'fields-green': (107, 72, 45, 46, 32), 'market-breeze': (106, 11, 45, 107, 32),
    'world-march': (60, 73, 48, 107, 43), 'mountain-road': (77, 10, 49, 107, 70),
    'officers-oath': (77, 40, 48, 106, 42), 'council-lantern': (106, 68, 49, 107, 42),
    'army-banner': (60, 106, 48, 107, 43), 'research-stars': (10, 73, 49, 46, 42),
    'battle-storm': (106, 61, 48, 107, 43), 'battle-siege': (57, 40, 48, 106, 43),
    'victory-horizon': (56, 72, 48, 46, 43), 'defeat-moon': (42, 77, 49, 46, 43),
    'winter-silence': (10, 41, 49, 107, 70), 'unification': (73, 60, 48, 107, 43)
}
MARTIAL = {'battle', 'army', 'victory'}
PERCUSSION = {'wood', 'odaiko', 'taiko', 'tsuzumi', 'cymbal', 'hat'}


class Synth:
    def __init__(self, programs):
        lib = C.CDLL(ctypes.util.find_library("fluidsynth") or "libfluidsynth.so.3")

        def binding(name, result, *args):
            method = getattr(lib, name)
            method.restype = result
            method.argtypes = list(args)
            return method

        ptr, i = C.c_void_p, C.c_int
        self.settings = binding("new_fluid_settings", ptr)()
        setnum = binding("fluid_settings_setnum", i, ptr, C.c_char_p, C.c_double)
        setnum(self.settings, b"synth.sample-rate", RATE)
        setnum(self.settings, b"synth.gain", 0.65)
        self.handle = binding("new_fluid_synth", ptr, ptr)(self.settings)
        bank = binding("fluid_synth_sfload", i, ptr, C.c_char_p, i)(self.handle, os.fsencode(SOUNDFONT), 1)
        if bank < 0:
            raise RuntimeError(f"Cannot load the soundfont {SOUNDFONT}")
        select = binding("fluid_synth_program_select", i, ptr, i, i, i, i)
        self.on = binding("fluid_synth_noteon", i, ptr, i, i, i)
        self.off = binding("fluid_synth_noteoff", i, ptr, i, i)
        self.cc = binding("fluid_synth_cc", i, ptr, i, i, i)
        self.write = binding("fluid_synth_write_float", i, ptr, i, ptr, i, i, ptr, i, i)
        self.destroy = binding("delete_fluid_synth", None, ptr)
        self.close_settings = binding("delete_fluid_settings", None, ptr)
        for channel, (program, volume, pan, room) in enumerate(programs):
            select(self.handle, channel, bank, 128 if channel == 9 else 0, program)
            for control, val in [(7, volume), (10, pan), (91, room), (93, 7)]:
                self.cc(self.handle, channel, control, val)

    def render(self, target, start, end):
        if start < end:
            ptr = target.ctypes.data
            self.write(self.handle, end-start, ptr, start*2, 2, ptr, start*2+1, 2)

    def close(self):
        self.destroy(self.handle)
        self.close_settings(self.settings)


def drum(kind, hand, rng):
    specs = {'odaiko': (52, 1.16, .78), 'taiko': (84, .79, .66),
             'tsuzumi': (219, .32, .55), 'wood': (705, .14, .45)}
    base, length, strength = specs[kind]
    t = np.arange(round(RATE*length)) / RATE
    modes = [(1, 1, 3.4), (1.59, .57, 4.7), (2.17, .39, 6.8),
             (2.82, .28, 10.8), (3.63, .26, 12.3), (5.02, .17, 18.7)]
    signal = np.zeros(len(t))
    for ratio, amp, decay in modes:
        # Membrane tension rises briefly under the stroke. The irregular
        # modal spacing, displaced strike and hand offset distinguish timbres.
        phase = 2*np.pi*base*ratio*(1+.019*hand)*(t+.016*(1-np.exp(-t/.055)))
        signal += amp*np.sin(phase+(.33 if hand and ratio > 2 else 0))*np.exp(-t*decay/length)
    snap = sosfilt(butter(2, [420, 3600], btype='bandpass', fs=RATE, output='sos'), rng.normal(size=len(t)))
    signal = np.tanh((signal + snap*np.exp(-t/.021)*1.2)*.82)*strength
    return signal*np.minimum(t/.0018, 1)*np.minimum((length-t)/.008, 1)


def write_track(track, folder):
    name = track['id']
    harmony_instruments = CHAIRS[name]
    lead, answer, bowed, plucked, bass = harmony_instruments
    martial = track['scene'] in MARTIAL
    # Separate channels allow held strings, short bows and two plucked hands
    # to overlap without MIDI note-offs cutting unrelated articulations.
    programs = [(lead,117,61,32), (answer,108,76,39), (bowed,91,42,40),
                (plucked,99,38,30), (bass,98,60,18), (52,79,70,56),
                (60,97,79,30), (14,84,86,54), (45,100,47,27),
                (0,100,64,33), (106,107,75,26), (73,94,79,39),
                (46,98,89,40), (48,83,77,46), (47,103,49,29), (68,86,44,49)]
    synth = Synth(programs)
    total = round(track['duration']*RATE)
    tail = round(3.5*RATE)
    audio = np.zeros((total+tail, 2), dtype=np.float32)
    percussion = np.zeros_like(audio)
    rng = np.random.default_rng(sum((i+1)*ord(c) for i,c in enumerate(name)))
    drums = {(kind, side):drum(kind, side, rng) for kind in ('odaiko','taiko','tsuzumi','wood') for side in [0,1]}
    instructions = []
    beat = 60 / track['tempo']

    def place(pos, length, channel, pitch, velocity, gate=1.0):
        start = min(total-1,max(0,round(RATE*pos)))
        end = round(RATE*(pos+max(.045, length*gate)))
        instructions.extend([(start,1,channel,pitch,velocity), (min(len(audio),end),0,channel,pitch,0)])

    for event in track['score']['events']:
        kind, part = event['type'], event['part']
        at, length = event['beat']*beat, event['duration']*beat
        level = event['velocity']; pitch = event.get('midi',60)
        velocity = int(np.clip(35+66*level+rng.uniform(-2.5,2.5),35,118))
        full = event['section'] == 'climax'
        if kind in PERCUSSION:
            if kind in ['hat','cymbal']:
                place(at,length,9,42 if kind=='hat' else 49,min(110,velocity+5))
            else:
                wave = drums[kind, event.get('alternate',0)]
                start = round(at*RATE)
                pan = .5+event.get('pan',0)*.66
                weight = .38 if kind in ('odaiko','taiko') else .21
                percussion[start:start+len(wave),0] += wave*level*weight*math.sqrt(1-pan)
                percussion[start:start+len(wave),1] += wave*level*weight*math.sqrt(pan)
                if kind=='odaiko' and (full or event['beat']<2):
                    place(at,.75,14,38+(name=='victory-horizon')*5,min(108,velocity+2))
            continue
        if part=='lead':
            # In the middle interlude the answer chair takes over the melody.
            channel=(1 if event['section']=='break' and answer!=61 else 0)
            if name in ('defeat-moon','castle-evening') and channel==0: pitch-=12
        elif part=='answer': channel=1 if kind!='brass' or answer in (56,57,60,61) else 6
        elif kind=='bass': channel=4
        elif kind=='choir': channel=5
        elif kind=='sho': channel=15
        elif kind in ('bell','kane'): channel=7
        elif kind=='strings': channel=8 if part=='ostinato' else (2 if event.get('pan',0)<0 else 13)
        elif kind=='brass': channel=6
        elif part=='ornament': channel=12
        else: channel=10 if kind=='shamisen' else 3
        if part in ('answer','ostinato','ornament'): at+=rng.uniform(.002,.009)
        place(at,length,channel,pitch,velocity)
        if part=='lead' and full and length>.26 and (martial or name=='unification'):
            place(at+.018,length,11 if name=='battle-storm' else 13,pitch+(12 if pitch<64 else 0),max(45,velocity-15),.93)

    # End a previous articulation before striking that exact key again. A
    # delayed note-off from an older articulation must not cut its successor.
    instructions.sort()
    stops = {}
    for sample, on, channel, pitch, velocity in instructions:
        stops.setdefault((channel,pitch), []).append((sample,on,velocity))
    events=[]
    for (channel,pitch),key_events in stops.items():
        active=0
        for sample,on,velocity in key_events:
            if on:
                if active: events.append((sample,0,channel,pitch,0))
                active+=1;events.append((sample,1,channel,pitch,velocity))
            else:
                active=max(0,active-1)
                if not active: events.append((sample,0,channel,pitch,0))
    current=0
    for sample,on,channel,pitch,velocity in sorted(events):
        synth.render(audio,current,sample)
        if on: synth.on(synth.handle,channel,pitch,velocity)
        else: synth.off(synth.handle,channel,pitch)
        current=sample
    synth.render(audio,current,len(audio));synth.close()
    # Feed early reflections into the opposite side, then fold the preceding
    # loop's releases into the opening. There is no fade to silence at the seam.
    audio+=percussion
    for delay, weight in [(0.028,.115),(.051,.072),(.089,.047),(.137,.025)]:
        offset=round(delay*RATE)
        audio[offset:]+=percussion[:-offset,::-1]*weight
    audio=sosfilt(butter(2,32,btype='highpass',fs=RATE,output='sos'),audio,axis=0).astype(np.float32)
    audio[:tail]+=audio[total:total+tail]*np.linspace(1,0,tail,dtype=np.float32)[:,None]
    audio=audio[:total]
    # Only correct residual sub-millisecond discontinuity without altering
    # the downbeat. The encoder writes gapless LAME delay/padding information.
    n=round(.006*RATE)
    audio[:n]+=(audio[-1]-audio[0])*np.linspace(1,0,n,dtype=np.float32)[:,None]
    intermediate=folder/(name+'.wav')
    wavfile.write(intermediate,RATE,audio)
    report=subprocess.run(['ffmpeg','-hide_banner','-i',str(intermediate),'-af','loudnorm=print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    data=json.loads(report.stderr[report.stderr.rfind('{'):report.stderr.rfind('}')+1])
    target=-17.5 if martial or name=='unification' else -19.5 if name in ('defeat-moon','winter-silence','castle-evening','mountain-road') else -18.6
    gain=min(target-float(data['input_i']),-2.0-float(data['input_tp']))
    path=OUT/(name+'.mp3')
    subprocess.run(['ffmpeg','-loglevel','error','-y','-i',str(intermediate),'-af',f'volume={gain:.4f}dB','-c:a','libmp3lame','-b:a','112k','-ar',str(RATE),'-write_xing','1','-metadata','title='+track['name'],'-metadata','album=戦国VS 戦国の音楽帳','-metadata','artist=KASAI SOLUTIONS',str(path)],check=True)
    intermediate.unlink()
    print(f"{name:18} {total/RATE:5.1f}s, {float(data['input_i'])+gain:5.1f} LUFS, {float(data['input_tp'])+gain:5.1f} dBTP",flush=True)


def measure_master(track):
    path=OUT/(track['id']+'.mp3')
    report=subprocess.run(['ffmpeg','-hide_banner','-i',str(path),'-af','loudnorm=print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    data=json.loads(report.stderr[report.stderr.rfind('{'):report.stderr.rfind('}')+1])
    raw=subprocess.check_output(['ffmpeg','-loglevel','error','-i',str(path),'-f','f32le','-'])
    pcm=np.frombuffer(raw,dtype='<f4').reshape((-1,2))
    duration=len(pcm)/RATE
    if abs(track['duration']-duration)>2/RATE or not np.isfinite(pcm).all():
        raise RuntimeError('Decoded loop duration or samples are invalid: '+track['id'])
    peak=float(np.abs(pcm).max())
    seam=float(np.abs(pcm[0]-pcm[-1]).max())
    lufs=float(data['input_i'])
    if peak >= 1 or seam > .055 or not -26<lufs<-12:
        raise RuntimeError(f"Master check failed: {track['id']} peak={peak} seam={seam} loudness={lufs}")
    import hashlib
    return {'title':track['name'],'samples':len(pcm),'duration':round(duration,4),'lufs':lufs,
            'truePeakDb':float(data['input_tp']),'seamDelta':round(seam,6),
            'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def write_manifest(scores):
    tracks={track['id']:measure_master(track) for track in scores}
    if len({item['sha256'] for item in tracks.values()})!=16:
        raise RuntimeError('All sixteen masters must be distinct')
    result={'format':'MP3 stereo','sampleRate':RATE,'bitrate':112000,
            'instruments':'TimGM6mb (Tim Brechbill and David Bolton), FluidSynth and original modeled percussion',
            'tracks':tracks}
    (OUT/'masters.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    # Uploaded recordings have no generated score. Keep their original audio intact.
    script = "require('./music.js');process.stdout.write(JSON.stringify(SENGOKU_MUSIC_TRACKS.filter(t=>!t.recordingOnly).map(t=>({...t,score:SengokuMusic.inspect(t.id)}))))"
    scores=json.loads(subprocess.check_output(['node','-e',script],cwd=ROOT))
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--verify-existing',action='store_true',help='Measure the current MP3 masters without re-rendering them')
    if not parser.parse_args().verify_existing:
        with tempfile.TemporaryDirectory() as folder:
            for track in scores:
                write_track(track,Path(folder))
    write_manifest(scores)


if __name__=='__main__':
    main()
