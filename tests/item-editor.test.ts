import {describe,it,expect} from 'vitest';
import {itemFields,type Item} from '../shared/domain';
import {openEditor,editField,receiveItem,resolveField,editorDirty,acknowledgeSave,fieldSubmission} from '../shared/item-editor';
const item=(overrides:Partial<Item>={}):Item=>({...itemFields.parse({}),id:'item-1',code:'DEMO-001',sampleId:null,status:'intake',version:1,createdAt:'',updatedAt:'',cover:null,photoCount:0,...overrides});
describe('item editing while notes and uploads update the record',()=>{
 it('keeps an unsaved title and availability alongside applied voice notes',()=>{
  let editor=editField(editField(openEditor(item()),'title','Step stool'),'availability','available');
  editor=receiveItem(editor,item({version:2,researchNotes:'Possibly a child’s ladder.'}));
  expect(editor.draft).toMatchObject({title:'Step stool',availability:'available',researchNotes:'Possibly a child’s ladder.',version:2});
  expect(editor.conflicts).toEqual([]);expect(editorDirty(editor)).toBe(true);
  const saved={...editor.draft,version:3};editor=acknowledgeSave(editor,editor.draft,saved);
  expect(editorDirty(editor)).toBe(false);expect(editor.draft.researchNotes).toBe(saved.researchNotes);
 });
 it('rebases on media-only version changes without a false conflict',()=>{
  const editor=receiveItem(editField(openEditor(item()),'condition','Worn'),item({version:3,photoCount:2,cover:'photo-1'}));
  expect(editor.draft).toMatchObject({condition:'Worn',photoCount:2,cover:'photo-1',version:3});expect(editor.conflicts).toEqual([]);
 });
 it('keeps both conflicting values until explicitly resolved, including repeated refreshes',()=>{
  let editor=receiveItem(editField(openEditor(item({condition:'Original'})),'condition','My edit'),item({version:2,condition:'Voice note'}));
  editor=receiveItem(editor,item({version:3,condition:'Voice note',photoCount:1}));
  expect(editor.conflicts).toEqual(['condition']);expect(editor.draft.condition).toBe('My edit');expect(editor.base.condition).toBe('Voice note');
  const mine=resolveField(editor,'condition','mine');expect(mine.conflicts).toEqual([]);expect(editorDirty(mine)).toBe(true);
  const saved=resolveField(editor,'condition','saved');expect(saved.conflicts).toEqual([]);expect(editorDirty(saved)).toBe(false);
 });
 it('detects another change after the user resolved a previous conflict',()=>{
  let editor=receiveItem(editField(openEditor(item()),'location','Shelf A'),item({version:2,location:'Shelf B'}));
  editor=resolveField(editor,'location','mine');editor=receiveItem(editor,item({version:3,location:'Shelf C'}));
  expect(editor.conflicts).toEqual(['location']);
 });
 it('does not conflict when both sides arrive at the same value',()=>{
  const editor=receiveItem(editField(openEditor(item()),'location','Shelf A'),item({version:2,location:'Shelf A'}));
  expect(editor.conflicts).toEqual([]);expect(editorDirty(editor)).toBe(false);
 });
 it('ignores out-of-order reads after a successful save',()=>{
  const editor=openEditor(item({version:4,title:'Saved'}));expect(receiveItem(editor,item({version:2,title:'Old'}))).toBe(editor);
 });
 it('preserves typing made while a save response was in flight',()=>{
  let editor=editField(openEditor(item()),'title','First edit');const submitted=editor.draft;
  editor=editField(editor,'title','Second edit');editor=acknowledgeSave(editor,submitted,{...submitted,version:2});
  expect(editor.draft.title).toBe('Second edit');expect(editor.base.title).toBe('First edit');expect(editorDirty(editor)).toBe(true);expect(editor.conflicts).toEqual([]);
 });
 it('preserves intentional clearing and compares arrays by value',()=>{
  let editor=editField(openEditor(item({notes:'Old note',observations:['Mark']})),'notes','');
  editor=receiveItem(editor,item({version:2,notes:'Old note',observations:['Mark'],measurements:'3 feet'}));
  expect(editor.draft.notes).toBe('');expect(editor.draft.measurements).toBe('3 feet');expect(editor.conflicts).toEqual([]);
 });
 it('refuses to merge unrelated items',()=>{expect(()=>receiveItem(openEditor(item()),item({id:'different'}))).toThrow();});
});


describe('saving just the item name',()=>{
 it('saves the name against the latest version while preserving other local edits and applied notes',()=>{
  let editor=editField(editField(openEditor(item({title:'Item DEMO-001',location:'Shelf A'})),'title','Instant Pot Duo'),'location','Shelf B');
  editor=receiveItem(editor,item({title:'Item DEMO-001',version:2,condition:'Voice note applied',location:'Shelf A'}));
  const submitted=fieldSubmission(editor,'title');
  expect(submitted).toMatchObject({title:'Instant Pot Duo',version:2,condition:'Voice note applied',location:'Shelf A',code:'DEMO-001'});
  editor=acknowledgeSave(editor,submitted,{...submitted,version:3});
  expect(editor.base.title).toBe('Instant Pot Duo');expect(editor.base.location).toBe('Shelf A');expect(editor.draft.location).toBe('Shelf B');expect(editorDirty(editor)).toBe(true);expect(editor.conflicts).toEqual([]);
 });
 it('refuses a competing name until the user explicitly chooses one',()=>{
  let editor=receiveItem(editField(openEditor(item({title:'Original'})),'title','My name'),item({version:2,title:'Other name'}));
  expect(()=>fieldSubmission(editor,'title')).toThrow('Choose which value');
  editor=resolveField(editor,'title','mine');expect(fieldSubmission(editor,'title')).toMatchObject({title:'My name',version:2});
 });
 it('does not resolve or save an unrelated competing edit during a rename',()=>{
  let editor=editField(editField(openEditor(item({title:'Original',condition:'Original condition'})),'title','New name'),'condition','My condition');
  editor=receiveItem(editor,item({version:2,title:'Original',condition:'Saved condition'}));
  const submitted=fieldSubmission(editor,'title');expect(submitted.condition).toBe('Saved condition');
  editor=acknowledgeSave(editor,submitted,{...submitted,version:3});expect(editor.conflicts).toEqual(['condition']);expect(editor.draft.condition).toBe('My condition');
 });
});
