from pathlib import Path
import json,collections,datetime,math
ROOT=Path(__file__).resolve().parents[2];DATA=ROOT/'assets/map'
def load(name):return json.loads((DATA/name).read_text())
land=load('japan-land-10m.geojson');prefs=load('japan-prefectures-10m.geojson');rivers=load('japan-rivers-10m.geojson');lakes=load('japan-lakes-10m.geojson')
edges=collections.Counter()
for f in prefs['features']:
 for polygon in f['geometry']['coordinates']:
  for ring in polygon:
   for a,b in zip(ring,ring[1:]):
    aa=tuple(round(v,9) for v in a);bb=tuple(round(v,9) for v in b)
    if aa!=bb:edges[tuple(sorted((aa,bb)))]+=1
shared={e for e,n in edges.items() if n==2};adj=collections.defaultdict(set)
for a,b in shared:adj[a].add(b);adj[b].add(a)
remaining=set(shared);lines=[]
def trace(start,nxt):
 line=[start,nxt];remaining.remove(tuple(sorted((start,nxt))));prev=start;cur=nxt
 while len(adj[cur])==2:
  following=next(v for v in adj[cur] if v!=prev);e=tuple(sorted((cur,following)))
  if e not in remaining:break
  remaining.remove(e);line.append(following);prev,cur=cur,following
 return line
for node,neighbors in adj.items():
 if len(neighbors)!=2:
  for nxt in neighbors:
   if tuple(sorted((node,nxt))) in remaining:lines.append(trace(node,nxt))
while remaining:
 a,b=next(iter(remaining));lines.append(trace(a,b))
boundaries={'type':'FeatureCollection','features':[{'type':'Feature','properties':{'name':'Modern prefectural boundaries','name_ja':'現代の都道府県境（参考）','sourceID':'natural-earth-prefectures','era':'modern'},'geometry':{'type':'MultiLineString','coordinates':lines}}]}
(DATA/'japan-prefecture-boundaries-10m.geojson').write_text(json.dumps(boundaries,ensure_ascii=False,separators=(',',':'))+'\n')
castles={}
coords=DATA/'castle-coordinates.json'
if coords.exists():
 records=json.loads(coords.read_text());records=records.get('castles',records) if isinstance(records,dict) else records
 if isinstance(records,list):castles={r['id']:r for r in records}
 else:castles=records
terrain={'url':'assets/map/japan-terrain-gsi-z8.webp','bounds':[122.34375,23.24134610238614,154.6875,46.07323062540836],'projection':'mercator','crs':'EPSG:3857','kind':'color','width':5888,'height':5120,'tileZoom':8,'sourceID':'gsi-dem','description':'国土地理院の標高・陰影起伏データによる段彩地形。衛星写真ではありません。'}
sources=[{'id':'natural-earth-land','label':'Natural Earth 1:10m（海岸線・参考県境）','url':'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/','license':'Public domain','version':'5.1.1'},{'id':'gsi-dem','label':'地理院タイル（国土地理院）を加工して作成','url':'https://maps.gsi.go.jp/development/ichiran.html','specificationURL':'https://maps.gsi.go.jp/development/demtile.html'},{'id':'natural-earth-water','label':'Natural Earth 1:10m（主要河川・湖）','url':'https://www.naturalearthdata.com/downloads/10m-physical-vectors/','license':'Public domain'},{'id':'codh','label':'歴史地名データ：CODH','url':'https://geoshape.ex.nii.ac.jp/nrct-poi/'},{'id':'castle-coordinates','label':'城の位置・地図データの出典','url':'SOURCES-MAP.md'}]
geo={'version':1,'projection':{'type':'mercator','crs':'EPSG:3857','coordinateOrder':'longitude,latitude'},'bounds':[122,24,149,46],'dataBounds':[122.93816165500004,24.212103583000044,153.98560631600003,45.520412502000056],'land':land,'prefectures':prefs,'boundaries':boundaries,'lakes':lakes,'rivers':rivers,'terrain':terrain,'hillshadeAlternative':{**terrain,'url':'assets/map/japan-hillshade-gsi-z8.webp','kind':'hillshade'},'castles':castles,'sources':sources,'notes':['海岸線・地形は現代の地理資料を使用しています。戦国時代の海岸線そのものを復元したものではありません。','県境は現代の位置把握のための参考表示です。勢力・領地はゲームの状態を表します。','城の座標は史跡・施設の代表点です。構内の天守中心や測量基準点を意味しません。']}
# Browser coordinates retain the published six-decimal precision. Shared
# coastal/border vertices appear once on the wire; GeoJSON nesting, order and
# repeated vertices are restored when the geography script is first loaded.
def signed_delta(value):
    encoded = (value << 1) if value >= 0 else ((-value << 1) - 1)
    characters = []
    while encoded >= 32:
        characters.append(chr(95 + (encoded & 31)))
        encoded >>= 5
    characters.append(chr(63 + encoded))
    return ''.join(characters)


vertex_ids = {}
vertex_stream = []
last_vertex = (0, 0)


def vertex_index(point):
    global last_vertex
    coordinate = tuple(round(round(value, 6) * 1000000) for value in point)
    if coordinate not in vertex_ids:
        vertex_ids[coordinate] = len(vertex_ids)
        vertex_stream.extend(signed_delta(value - before) for value, before in zip(coordinate, last_vertex))
        last_vertex = coordinate
    return vertex_ids[coordinate]


def pack_coordinates(values):
    if not values:
        return []
    if isinstance(values[0], (int, float)):
        return vertex_index(values)
    if values[0] and isinstance(values[0][0], (int, float)):
        previous = 0
        parts = []
        for point in values:
            index = vertex_index(point)
            parts.append(signed_delta(index - previous))
            previous = index
        return ''.join(parts)
    return [pack_coordinates(child) for child in values]


for layer in (land, boundaries, prefs, rivers, lakes):
    for feature in layer['features']:
        geometry = feature['geometry']
        geometry['coordinates'] = pack_coordinates(geometry['coordinates'])

runtime = (DATA / 'unpack-coordinates.js').read_text()
payload = json.dumps(geo, ensure_ascii=False, separators=(',', ':'))
vertices = json.dumps(''.join(vertex_stream))
script = ("/* 実地理資料から作成。出典・精度・加工方法は SOURCES-MAP.md を参照。 */\n"
          "(function(root){\n'use strict';\n" + runtime
          + "root.SENGOKU_GEOGRAPHY=unpackGeography(" + payload + "," + vertices + ");\n"
          + "})(typeof window!=='undefined'?window:globalThis);\n")
(ROOT / 'map-data.js').write_text(script)
print(json.dumps({'mapDataBytes':(ROOT/'map-data.js').stat().st_size,'landPolygons':len(land['features'][0]['geometry']['coordinates']),'prefectures':len(prefs['features']),'boundarySegments':len(lines),'boundaryVertices':sum(len(line) for line in lines),'castles':len(castles),'terrain':terrain},ensure_ascii=False))
