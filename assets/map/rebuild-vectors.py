from pathlib import Path
import urllib.request,zipfile,struct,json,hashlib,datetime,math
import tempfile
ROOT=Path(__file__).resolve().parent;ROOT.mkdir(parents=True,exist_ok=True)
TMP=Path(tempfile.gettempdir())/'sengoku-geography-cache';TMP.mkdir(parents=True,exist_ok=True)
SOURCES=[]
def download(url,name):
 target=TMP/name
 if not target.exists():
  with urllib.request.urlopen(url,timeout=60) as r:target.write_bytes(r.read())
 data=target.read_bytes();SOURCES.append({'url':url,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 return zipfile.ZipFile(target)
def dbf(data):
 count,header,length=struct.unpack_from('<IHH',data,4);fields=[];pos=32
 while data[pos]!=13:
  f=data[pos:pos+32];fields.append((f[:11].split(b'\0')[0].decode('ascii'),f[16]));pos+=32
 rows=[]
 for i in range(count):
  rec=data[header+i*length:header+(i+1)*length];p=1;row={}
  for name,n in fields:
   row[name]=rec[p:p+n].decode('utf-8',errors='replace').strip(' \x00');p+=n
  rows.append(row)
 return rows
def area(ring):return sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]))/2
def inside(point,ring):
 x,y=point;result=False
 for a,b in zip(ring,ring[1:]):
  if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:result=not result
 return result
def shape_poly(data):
 shapeType=struct.unpack_from('<I',data)[0]
 if shapeType==0:return None
 if shapeType not in (5,15,25):raise ValueError(f'Not a polygon: {shapeType}')
 parts,n=struct.unpack_from('<II',data,36);starts=list(struct.unpack_from('<'+'I'*parts,data,44))+[n];offset=44+parts*4
 points=[list(struct.unpack_from('<dd',data,offset+i*16)) for i in range(n)]
 rings=[points[starts[i]:starts[i+1]] for i in range(parts)]
 outer=[r for r in rings if area(r)<0];holes=[r for r in rings if area(r)>=0]
 polygons=[[r] for r in outer]
 for h in holes:
  matches=[(abs(area(poly[0])),j) for j,poly in enumerate(polygons) if inside(h[0],poly[0])]
  if matches:polygons[min(matches)[1]].append(h)
  else:polygons.append([h])
 return {'type':'MultiPolygon','coordinates':polygons}
def read(z,filterRow):
 names=z.namelist();rows=dbf(z.read(next(n for n in names if n.endswith('.dbf'))));data=z.read(next(n for n in names if n.endswith('.shp')));p=100;index=0;out=[]
 while p<len(data):
  recnum,words=struct.unpack_from('>II',data,p);body=data[p+8:p+8+words*2]
  if filterRow(rows[index]):out.append({'type':'Feature','properties':rows[index],'geometry':shape_poly(body)})
  index+=1;p+=8+words*2
 assert index==len(rows)
 return out
countries=download('https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_0_countries.zip','ne_10m_admin_0_countries.zip')
land=read(countries,lambda r:r.get('ADM0_A3')=='JPN')
assert len(land)==1
for f in land:f['properties']={'name':'Japan','name_ja':'日本','source':'Natural Earth 1:10m Admin 0','scaleDenominator':10000000,'sourceID':'natural-earth-land'}
(ROOT/'japan-land-10m.geojson').write_text(json.dumps({'type':'FeatureCollection','features':land},ensure_ascii=False,separators=(',',':'))+'\n')
print('Official land polygons extracted.',flush=True)
admin=download('https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip','ne_10m_admin_1_states_provinces.zip')
prefs=read(admin,lambda r:r.get('adm0_a3')=='JPN')
for f in prefs:
 r=f['properties'];f['properties']={'name':r.get('name'),'name_ja':r.get('name_ja') or r.get('name_local') or r.get('name'),'iso':r.get('iso_3166_2'),'sourceID':'natural-earth-prefectures','era':'modern'}
(ROOT/'japan-prefectures-10m.geojson').write_text(json.dumps({'type':'FeatureCollection','features':prefs},ensure_ascii=False,separators=(',',':'))+'\n')
(ROOT/'natural-earth-source-manifest.json').write_text(json.dumps({'sources':SOURCES,'landFeatures':len(land),'prefectureFeatures':len(prefs),'processing':'Decoded original Natural Earth shapefile coordinates with no simplification; selected Japan; retained only display properties. Polygon rings grouped by shapefile winding and containment.'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'landFeatures':len(land),'prefectureFeatures':len(prefs),'files':[{p.name:p.stat().st_size} for p in ROOT.glob('*geojson')]},ensure_ascii=False),flush=True)
