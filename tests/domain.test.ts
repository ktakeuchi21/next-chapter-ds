import {describe,it,expect} from 'vitest';
import {itemFields,readiness,validateTransition,makeDraft,safeExternalUrl,fileKind} from '../shared/domain';
import {localMode,sameOrigin} from '../server/auth';
const fields=itemFields.parse({title:'Angel ornament'});
describe('listing readiness',()=>{
 it('does not treat unknown availability or a missing price as ready',()=>{expect(readiness(fields)).toHaveLength(6);expect(validateTransition('review','ready',fields,1)).toContain('Confirm this item is available');});
 it('requires a photo as well as confirmed operational details',()=>{const complete={...fields,owner:'Estate',location:'B3',condition:'Small chip on base',price:0,fulfillment:'pickup' as const,availability:'available' as const};expect(validateTransition('review','ready',complete,0)).toContain('photo');expect(validateTransition('review','ready',complete,1)).toBeNull();});
 it('rejects bypassing the sale lifecycle',()=>{expect(validateTransition('intake','sold',fields,1)).not.toBeNull();expect(validateTransition('sold','listed',fields,1)).not.toBeNull();});
 it('keeps owner/location/private notes out of public listing text',()=>{const draft=makeDraft({...fields,owner:'Private family',location:'Secret address',notes:'Door code 1234',condition:'Chip on base'});expect(draft.description).toContain('Chip on base');expect(JSON.stringify(draft)).not.toMatch(/Private family|Secret address|1234/);});
});
describe('input boundaries',()=>{
 it('rejects script URLs and embedded credentials',()=>{expect(safeExternalUrl('javascript:alert(1)')).toBe(false);expect(safeExternalUrl('https://user:pass@example.com')).toBe(false);expect(safeExternalUrl('https://www.ebay.com/itm/123')).toBe(true);});
 it('rejects HTML uploads and accepts recorder MIME parameters',()=>{expect(fileKind('text/html')).toBeNull();expect(fileKind('audio/webm;codecs=opus')).toBe('audio');});
 it('only allows explicit local mode on loopback',()=>{expect(localMode(new Request('https://public.example/api/items'),{LOCAL_DEV:'true'} as any)).toBe(false);expect(localMode(new Request('http://127.0.0.1:8787/api/items'),{LOCAL_DEV:'true'} as any)).toBe(true);expect(localMode(new Request('http://127.0.0.1:8787/api/items'),{LOCAL_DEV:'false'} as any)).toBe(false);});
 it('rejects cross-origin browser writes',()=>{expect(sameOrigin(new Request('https://inventory.example/api/items',{headers:{Origin:'https://evil.example'}}))).toBe(false);});
});
