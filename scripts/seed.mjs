// Fictional local examples with generated illustrations, not client photos.
import {deflateSync} from 'node:zlib';

const base = process.env.NEXT_CHAPTER_TEST_API || 'http://127.0.0.1:8787/api';
const url = new URL(base);
if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/api') {
  throw Error('Demo seeding is restricted to a local development API.');
}
async function request(path, init) {
  const response = await fetch(base + path, init);
  if (!response.ok) throw Error(`Local API returned ${response.status}. Start it and apply migrations first.`);
  return response.json();
}
if (!(await request('/config')).local) throw Error('Expected a local workspace.');

// Minimal PNG writer: simple geometric placeholders, with no metadata.
function illustration(kind) {
  const width = 320, height = 240, raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let color = [242, 240, 231];
    const cabinet = kind === 'cabinet' && x > 95 && x < 225 && y > 40 && y < 205;
    const lamp = kind === 'lamp' && ((y > 50 && y < 115 && Math.abs(x - 160) < 25 + (y - 50) / 2) || (x > 154 && x < 166 && y >= 115 && y < 193) || (x > 120 && x < 200 && y >= 193 && y < 205));
    const bowl = kind === 'bowl' && y > 120 && y < 190 && (x - 160) ** 2 / 90 ** 2 + (y - 115) ** 2 / 80 ** 2 < 1;
    if (cabinet || lamp || bowl) color = kind === 'cabinet' ? [162, 122, 87] : kind === 'lamp' ? [95, 123, 98] : [93, 135, 149];
    if (cabinet && (x === 160 || (y > 105 && y < 115 && (x === 150 || x === 170)))) color = [69, 61, 52];
    raw.set(color, y * (1 + width * 3) + 1 + x * 3);
  }
  function chunk(type, bytes) {
    const tag = Buffer.from(type), body = Buffer.concat([tag, bytes]);
    let crc = 0xffffffff;
    for (const b of body) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const examples = [{id:'demo-lamp', title:'Demo desk lamp', kind:'lamp'}, {id:'demo-cabinet', title:'Demo storage cabinet', kind:'cabinet'}, {id:'demo-bowl', title:'Demo ceramic bowl', kind:'bowl'}];
const existing = await request('/items');
for (const example of examples) {
  let item = existing.find(item => item.sampleId === example.id);
  if (!item) item = await request('/items', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title:example.title, sampleId:example.id, category:'Home & decor', notes:'Fictional demo item with a generated illustration. No real owner, condition, measurements or valuation.', observations:['Illustration only; replace with real photos before research.'], questions:['Add real photos and inspect the item before listing.']})
  });
  const detail = await request(`/items/${item.id}`), name = example.id + '.png';
  if (!detail.media.some(media => media.name === name)) {
    const form = new FormData(); form.append('file', new Blob([illustration(example.kind)], {type:'image/png'}), name);
    await request(`/items/${item.id}/media`, {method:'POST', body:form});
  }
  console.log(`Ready: ${example.title}`);
}
