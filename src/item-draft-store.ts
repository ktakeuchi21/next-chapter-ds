import {itemFields,type Fields,type Item} from '../shared/domain';
import {editorDirty,openEditor,receiveItem,type ItemEditor,type FieldName} from '../shared/item-editor';
const keys=Object.keys(itemFields.shape) as FieldName[];
const prefix='next-chapter:item-draft:';
type StorageLike=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
function fields(item:Item){return Object.fromEntries(keys.filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));}
function validFields(value:unknown):value is Fields{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const values=value as Record<string,unknown>;
 return Object.entries(values).every(([key,v])=>keys.includes(key as FieldName)&&(key==='price'?v===null||(typeof v==='number'&&Number.isFinite(v)):['observations','questions'].includes(key)?Array.isArray(v)&&v.every(x=>typeof x==='string'):typeof v==='string'));
}
// Store only editable fields and their comparison baseline. Server-owned status,
// marketplace data, and media are always taken from the latest server response.
export function keepItemDraft(storage:StorageLike,editor:ItemEditor){
 const key=prefix+editor.base.id;if(!editorDirty(editor)){storage.removeItem(key);return;}
 storage.setItem(key,JSON.stringify({schema:1,id:editor.base.id,version:editor.base.version,base:fields(editor.base),draft:fields(editor.draft),conflicts:editor.conflicts}));
}
export function recoverItemDraft(storage:StorageLike,latest:Item):ItemEditor{
 const raw=storage.getItem(prefix+latest.id);if(!raw)return openEditor(latest);
 try{
  if(raw.length>500000)throw Error('Draft is too large.');const saved=JSON.parse(raw);
  if(saved.schema!==1||saved.id!==latest.id||!Number.isInteger(saved.version)||saved.version<1||!validFields(saved.base)||!validFields(saved.draft)||!Array.isArray(saved.conflicts)||!saved.conflicts.every((k:unknown)=>typeof k==='string'&&keys.includes(k as FieldName)))throw Error('Draft format is invalid.');
  const base={...latest,...saved.base,version:saved.version},draft={...base,...saved.draft};
  return receiveItem({base,draft,conflicts:saved.conflicts},latest);
 }catch{throw Error('A device draft could not be read. Your cloud item is still available; keep this tab open while reviewing it.');}
}
