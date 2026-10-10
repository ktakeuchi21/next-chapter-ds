import {describe,it,expect} from 'vitest';
import {clientCode,validateGroups} from '../shared/intake';
import {fileKind,itemFields} from '../shared/domain';
describe('capture boundaries',()=>{
 it('uses readable client codes without requiring an item title',()=>{expect(clientCode('Jane Smith')).toBe('JSM');expect(clientCode('María García')).toBe('MGA');expect(clientCode('李')).toBe('CLI');expect(itemFields.parse({}).title).toBe('');});
 it('keeps real video separate from audio recordings',()=>{expect(fileKind('video/webm')).toBe('video');expect(fileKind('video/mp4')).toBe('video');expect(fileKind('video/quicktime')).toBe('video');expect(fileKind('audio/webm;codecs=opus')).toBe('audio');expect(fileKind('application/javascript')).toBeNull();});
 it('requires a complete nonduplicated grouping, including uncertain files',()=>{const group=(ids:string[])=>({title:'Figurine',mediaIds:ids,uncertain:true,reason:''});expect(()=>validateGroups([group(['a']),group(['a'])],['a','b'])).toThrow(/only one/);expect(()=>validateGroups([group(['a'])],['a','b'])).toThrow(/every/);expect(()=>validateGroups([group(['a','c'])],['a','b'])).toThrow(/every/);expect(validateGroups([group(['a','b'])],['a','b'])).toHaveLength(1);});
});
