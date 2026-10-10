import {it, expect} from 'vitest';
import {research} from '../server/ai';
import {itemFields} from '../shared/domain';
import type {Env} from '../server/types';

// Opt-in only: uses operator-provided photos and makes a paid provider request.
// Manifest shape: [{name, photos: ["path/to/photo.jpg"], condition?: string}].
it.skipIf(process.env.RUN_LIVE_PRICING_CHECK !== '1')('researches explicitly supplied local photos', async () => {
  const {readFileSync} = await import('node:fs');
  const {resolve, dirname, extname} = await import('node:path');
  const key = process.env.OPENAI_API_KEY;
  const manifestPath = process.env.PRICING_FIXTURES;
  if (!key || !manifestPath) throw Error('Set OPENAI_API_KEY and PRICING_FIXTURES in the local environment.');
  const examples = JSON.parse(readFileSync(manifestPath, 'utf8')) as {name:string; photos:string[]; condition?:string}[];
  if (!Array.isArray(examples) || !examples.length || examples.length > 3) throw Error('Supply one to three cases.');
  for (const example of examples) {
    if (!example.name || !Array.isArray(example.photos) || !example.photos.length || example.photos.length > 4) throw Error('Each case needs a name and one to four photos.');
    const photos = example.photos.map(photo => {
      const path = resolve(dirname(manifestPath), photo), extension = extname(path).toLowerCase();
      const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : ['.jpg','.jpeg'].includes(extension) ? 'image/jpeg' : null;
      if (!mime) throw Error('Use PNG, JPEG or WebP.');
      return {object_key:path, mime};
    });
    const fields = itemFields.parse({title:'Item TEST-001', condition:example.condition || ''});
    const row = {id:'test', code:'TEST-001', record_type:'item', data:JSON.stringify(fields)};
    const env = {
      OPENAI_API_KEY:key, RESEARCH_MODEL:process.env.RESEARCH_MODEL || 'gpt-4.1',
      DB:{prepare:() => ({bind:() => ({first:async () => row, all:async () => ({results:photos})})})},
      MEDIA:{get:async (path:string) => {const bytes = readFileSync(path); return {size:bytes.length, arrayBuffer:async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};}}
    } as unknown as Env;
    const result = await research(env, 'test');
    expect(result.text, example.name).toBeTruthy();
    expect(result.researchedAt).toBeTruthy();
    if (result.pricing) {
      expect(result.pricing.suggested).toBeGreaterThan(0);
      expect(result.pricing.assumptions.length).toBeGreaterThan(0);
    }
  }
}, 240000);
