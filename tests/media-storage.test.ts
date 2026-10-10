import {it,expect} from 'vitest';
import {byteRange,putOriginal} from '../server/media-storage';
it('normalizes byte ranges without allowing invalid or unsafe offsets',()=>{
 expect(byteRange(null,10)).toBeNull();expect(byteRange('bytes=0-4',10)).toEqual({offset:0,length:5});expect(byteRange('bytes=8-',10)).toEqual({offset:8,length:2});expect(byteRange('bytes=-20',10)).toEqual({offset:0,length:10});expect(byteRange('bytes=1-999',10)).toEqual({offset:1,length:9});
 for(const r of ['bytes=-0','bytes=4-2','bytes=-','bytes=10-','bytes=999999999999999999-'])expect(byteRange(r,10)).toBe('invalid');expect(byteRange('bytes=0-0',0)).toBe('invalid');expect(byteRange('bytes=0-2,5-8',10)).toBeNull();
});
it('an interrupted upload resumes only if its original bytes and MIME type match',async()=>{
 let object:any;const bucket:any={async put(_key:string,bytes:ArrayBuffer,options:any){expect(options.onlyIf.get('If-None-Match')).toBe('*');if(object)return null;object={size:bytes.byteLength,httpMetadata:options.httpMetadata,customMetadata:options.customMetadata};return object;},async head(){return object;}};
 const bytes=new TextEncoder().encode('first').buffer;await putOriginal(bucket,'key',bytes,'image/png');await putOriginal(bucket,'key',bytes,'image/png');
 await expect(putOriginal(bucket,'key',new TextEncoder().encode('other').buffer,'image/png')).rejects.toThrow(/already used/);await expect(putOriginal(bucket,'key',bytes,'audio/webm')).rejects.toThrow(/already used/);
});
