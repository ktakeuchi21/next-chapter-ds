import {it,expect,vi,afterEach} from 'vitest';
import {api} from '../src/api';
afterEach(()=>vi.unstubAllGlobals());
it('accepts a successful null transfer response and still rejects failed empty responses',async()=>{
 vi.stubGlobal('fetch',async()=>Response.json(null));expect(await api('/items/example/etsy-transfer')).toBeNull();
 vi.stubGlobal('fetch',async()=>Response.json(null,{status:500}));await expect(api('/items/example/etsy-transfer')).rejects.toMatchObject({status:500});
});
