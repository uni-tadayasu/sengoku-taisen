from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from io import BytesIO
import math,json,urllib.request,urllib.error,hashlib,datetime
import numpy as np
from PIL import Image
import tempfile
ROOT=Path(__file__).resolve().parent;CACHE=Path(tempfile.gettempdir())/'sengoku-gsi-map-tiles';CACHE.mkdir(exist_ok=True)
ZOOM=8;N=2**ZOOM
land=json.loads((ROOT/'japan-land-10m.geojson').read_text())['features'][0]['geometry']['coordinates']
def tx(lon):return int(math.floor((lon+180)/360*N))
def ty(lat):return int(math.floor((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*N))
def tilelat(y):return math.degrees(math.atan(math.sinh(math.pi*(1-2*y/N))))
candidates=set()
for poly in land:
 p=poly[0];xs=[q[0] for q in p];ys=[q[1] for q in p]
 for x in range(tx(min(xs)),tx(max(xs))+1):
  for y in range(ty(max(ys)),ty(min(ys))+1):candidates.add((x,y))
minx=min(x for x,y in candidates);maxx=max(x for x,y in candidates);miny=min(y for x,y in candidates);maxy=max(y for x,y in candidates)
bounds=[minx/N*360-180,tilelat(maxy+1),(maxx+1)/N*360-180,tilelat(miny)]
width=(maxx-minx+1)*256;height=(maxy-miny+1)*256
terrain=Image.new('RGBA',(width,height),(0,0,0,0));hillshade=Image.new('RGBA',(width,height),(0,0,0,0));records=[]
stops=np.array([-10,0,100,250,500,1000,1800,2500,3200,4000])
colors=np.array([[151,177,139],[176,194,147],[157,183,132],[136,168,114],[113,148,99],[102,135,94],[127,145,112],[160,165,140],[197,197,181],[231,231,219]])
def fetch(layer,x,y):
 url=f'https://cyberjapandata.gsi.go.jp/xyz/{layer}/{ZOOM}/{x}/{y}.png';cache=CACHE/f'{layer}-{ZOOM}-{x}-{y}.png';missing=cache.with_suffix('.missing')
 if missing.exists():return None,{'url':url,'status':404}
 if cache.exists():data=cache.read_bytes()
 else:
  try:
   with urllib.request.urlopen(url,timeout=30) as response:data=response.read()
  except urllib.error.HTTPError as e:
   if e.code==404:missing.write_text('404');return None,{'url':url,'status':404}
   raise
  if not data.startswith(b'\x89PNG'):raise ValueError('Non-PNG response for '+url)
  cache.write_bytes(data)
 return data,{'url':url,'status':200,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
def process(tile):
 x,y=tile;dem,dm=fetch('dem_png',x,y)
 if dem is None:return tile,None,None,[dm],None
 elevation=np.asarray(Image.open(BytesIO(dem)).convert('RGB'),dtype=np.int32)
 code=elevation[:,:,0]*65536+elevation[:,:,1]*256+elevation[:,:,2];valid=code!=8388608
 elev=np.where(code>8388608,code-16777216,code).astype(np.float32)*.01
 elev[~valid]=0
 shade,sm=fetch('hillshademap',x,y)
 rgba=np.asarray(Image.open(BytesIO(shade)).convert('RGBA')) if shade else np.full((256,256,4),128,dtype=np.uint8)
 intensity=rgba[:,:,:3].mean(axis=2)/255
 intensity=np.where(rgba[:,:,3]>0,intensity,.5)
 gain=.68+.64*intensity
 rgb=np.stack([np.interp(np.clip(elev,-10,4000),stops,colors[:,k]) for k in range(3)],axis=-1)
 rgb=np.clip(rgb*gain[:,:,None],0,255).astype(np.uint8)
 alpha=(valid.astype(np.uint8)*255)[:,:,None]
 shaded=Image.fromarray(np.concatenate([rgb,alpha],axis=2),'RGBA')
 hs=np.concatenate([np.repeat((intensity*255).astype(np.uint8)[:,:,None],3,axis=2),alpha],axis=2)
 return tile,shaded,Image.fromarray(hs,'RGBA'),[dm,sm],{'min':float(np.min(elev[valid])),'max':float(np.max(elev[valid])),'validPixels':int(np.count_nonzero(valid))} if np.any(valid) else None
print(json.dumps({'tiles':len(candidates),'bounds':bounds,'pixels':[width,height],'zoom':ZOOM}),flush=True)
valid_tiles=0;extremes=[]
with ThreadPoolExecutor(max_workers=6) as pool:
 futures={pool.submit(process,tile):tile for tile in sorted(candidates)}
 for i,future in enumerate(as_completed(futures),1):
  tile,color,shade,meta,stats=future.result();records.extend(meta)
  if color is not None:
   x,y=tile;pos=((x-minx)*256,(y-miny)*256);terrain.paste(color,pos);hillshade.paste(shade,pos);valid_tiles+=1
   if stats:extremes.append(stats)
  if i%25==0 or i==len(futures):print(json.dumps({'completed':i,'total':len(futures),'withDEM':valid_tiles}),flush=True)
assert valid_tiles>30
terrain.save(ROOT/'japan-terrain-gsi-z8.webp','WEBP',quality=90,method=6)
hillshade.save(ROOT/'japan-hillshade-gsi-z8.webp','WEBP',quality=90,method=6)
preview=terrain.copy();preview.thumbnail((1400,1400));preview.save(CACHE/'japan-terrain-preview.png')
manifest={'source':'Geospatial Information Authority of Japan','sourceURL':'https://maps.gsi.go.jp/development/ichiran.html','demSpecificationURL':'https://maps.gsi.go.jp/development/demtile.html','attribution':'地理院タイル（国土地理院）を加工して作成','projection':'EPSG:3857','bounds':bounds,'width':width,'height':height,'tileZoom':ZOOM,'tileRange':{'minX':minx,'maxX':maxx,'minY':miny,'maxY':maxy},'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'validDEMTiles':valid_tiles,'palette':'Hypsometric tint based on decoded DEM elevations, combined with GSI hillshade. This is a terrain visualization, not satellite imagery.','elevationRangeMetres':[min(e['min'] for e in extremes),max(e['max'] for e in extremes)],'records':sorted(records,key=lambda r:r['url'])}
(ROOT/'gsi-terrain-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'finished':True,'terrainBytes':(ROOT/'japan-terrain-gsi-z8.webp').stat().st_size,'hillshadeBytes':(ROOT/'japan-hillshade-gsi-z8.webp').stat().st_size,'bounds':bounds,'validTiles':valid_tiles}),flush=True)
