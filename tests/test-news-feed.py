"""Read the shipped RSS with an XML parser and follow its public links."""
import json
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
site = json.loads((root / 'site-metadata.json').read_text())
origin = site['origin']
feed_url = origin + '/news/feed.xml'
ns = {'atom': 'http://www.w3.org/2005/Atom', 'dc': 'http://purl.org/dc/elements/1.1/'}


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.ids = set()
        self.links = []
        self.text = []
        self.feed(html)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if attrs.get('id'):
            self.ids.add(attrs['id'])
        if tag == 'link':
            self.links.append(attrs)

    def handle_data(self, value):
        self.text.append(value)


feed = ET.parse(root / 'news/feed.xml').getroot()
assert feed.tag == 'rss' and feed.attrib.get('version') == '2.0'
channel = feed.find('channel')
assert channel is not None
assert channel.findtext('link') == origin + site['pages']['news']['path']
self_link = channel.find('atom:link', ns)
assert self_link is not None and self_link.attrib == {
    'href': feed_url, 'rel': 'self', 'type': 'application/rss+xml'
}
items = channel.findall('item')
assert 1 <= len(items) <= 30, 'Publish a bounded set of useful updates'
seen = set()
dates = []
for item in items:
    url = item.findtext('link')
    parsed = urlparse(url)
    assert parsed.scheme + '://' + parsed.netloc == origin
    assert parsed.path == '/news/' and parsed.fragment and not parsed.query
    assert url == item.findtext('guid') and url not in seen
    assert item.find('guid').attrib.get('isPermaLink') == 'true'
    seen.add(url)
    dates.append(date.fromisoformat(item.findtext('dc:date', namespaces=ns)))
    page = Page((root / parsed.path.strip('/') / 'index.html').read_text())
    assert parsed.fragment in page.ids, 'Every feed item must open its visible release note'
    assert item.findtext('title').split('｜', 1)[-1] in ''.join(page.text)
    assert len(item.findtext('description') or '') > 60
    assert not list(item.find('description')), 'Feed copy stays text, without active HTML'
assert dates == sorted(dates, reverse=True)
assert max(dates) <= date.fromisoformat(site['dateModified'])
for spec in site['pages'].values():
    page = Page((root / spec['path'].strip('/') / 'index.html').read_text())
    feeds = [link for link in page.links if link.get('rel') == 'alternate' and link.get('type') == 'application/rss+xml']
    assert len(feeds) == 1
    assert urljoin(origin + spec['path'], feeds[0]['href']) == feed_url
print(f'PASS valid RSS XML, {len(items)} permanent release links, verified dates, and {len(site["pages"])} discovery links')
