import {itemFields,type Fields,type Item} from './domain';

export type FieldName=keyof Fields;
export type ItemEditor={base:Item;draft:Item;conflicts:FieldName[]};
const keys=Object.keys(itemFields.shape) as FieldName[];
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const openEditor=(item:Item):ItemEditor=>({base:item,draft:item,conflicts:[]});
export const editorDirty=(editor:ItemEditor)=>editor.conflicts.length>0||keys.some(key=>!same(editor.base[key],editor.draft[key]));

// Rebase only fields the user edited. Keep new photos, note updates and other
// untouched server fields, without silently overwriting competing field edits.
export function receiveItem(editor:ItemEditor,latest:Item):ItemEditor{
 if(latest.id!==editor.base.id)throw Error('Cannot merge different items.');
 if(latest.version<editor.base.version)return editor;
 const draft={...latest};const conflicts:FieldName[]=[];
 for(const key of keys){
  const localChanged=!same(editor.draft[key],editor.base[key]);
  if(!localChanged)continue;
  Object.assign(draft,{[key]:editor.draft[key]});
  if(!same(editor.draft[key],latest[key])&&(editor.conflicts.includes(key)||!same(editor.base[key],latest[key])))conflicts.push(key);
 }
 return {base:latest,draft,conflicts};
}
export function editField(editor:ItemEditor,key:FieldName,value:unknown):ItemEditor{
 return {...editor,draft:{...editor.draft,[key]:value}};
}
export function resolveField(editor:ItemEditor,key:FieldName,choice:'mine'|'saved'):ItemEditor{
 return {...editor,draft:choice==='saved'?{...editor.draft,[key]:editor.base[key]}:editor.draft,conflicts:editor.conflicts.filter(k=>k!==key)};
}
// Save one field against the latest server version, leaving other local edits unsaved.
export function fieldSubmission(editor:ItemEditor,key:FieldName):Item{
 if(editor.conflicts.includes(key))throw Error('This field also changed in the saved item. Choose which value to keep.');
 return {...editor.base,[key]:editor.draft[key]};
}
// A completed save acknowledges exactly the submitted draft. Any edits made
// while its response was in flight remain local, and older reads are ignored.
export function acknowledgeSave(editor:ItemEditor,submitted:Item,saved:Item):ItemEditor{
 if(editor.base.version>saved.version)return editor;
 return receiveItem({base:submitted,draft:editor.draft,conflicts:editor.conflicts},saved);
}

export const fieldLabels:Record<FieldName,string>={pickupArea:'General pickup area',loadingNotes:'Loading & access',clearBy:'Collection deadline',valueEstimate:'Seller / client’s estimate',title:'Item name',owner:'Owner or estate',location:'Storage location',category:'Category',notes:'Private notes',condition:'Condition',measurements:'Measurements & weight',price:'Asking price',fulfillment:'Pickup or shipping',availability:'Availability',observations:'Photo observations',questions:'Research questions',identification:'Identification',researchNotes:'Item research notes',draftResearchAt:'Draft research date',draftTitle:'Listing title',draftDescription:'Listing description'};
