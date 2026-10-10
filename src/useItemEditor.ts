import {useRef,useState} from 'react';
import type {Item} from '../shared/domain';
import {acknowledgeSave,editField,editorDirty,openEditor,receiveItem,resolveField,type ItemEditor,type FieldName} from '../shared/item-editor';
import {keepItemDraft,recoverItemDraft} from './item-draft-store';
export function useItemEditor(){
 const current=useRef<ItemEditor|null>(null),recoveryBlocked=useRef(false);
 const [editor,setEditor]=useState<ItemEditor|null>(null),[storageError,setStorageError]=useState(''),[recovered,setRecovered]=useState(false);
 const commit=(next:ItemEditor)=>{current.current=next;setEditor(next);try{keepItemDraft(localStorage,next);setStorageError('');}catch{setStorageError('Your edits are only in this tab. Device storage is unavailable; keep this page open and save your changes before leaving.');}return next;};
 const receive=(item:Item)=>{
  if(current.current?.base.id===item.id){const next=receiveItem(current.current,item);if(recoveryBlocked.current){current.current=next;setEditor(next);return next;}return commit(next);}
  let next:ItemEditor;try{next=recoverItemDraft(localStorage,item);}catch(e){recoveryBlocked.current=true;next=openEditor(item);current.current=next;setEditor(next);setStorageError((e as Error).message);return next;}
  setRecovered(editorDirty(next));return commit(next);
 };
 const edit=(key:FieldName,value:unknown)=>{if(current.current){recoveryBlocked.current=false;commit(editField(current.current,key,value));}};
 const editMany=(values:Partial<Item>)=>{if(current.current){recoveryBlocked.current=false;commit({...current.current,draft:{...current.current.draft,...values}});}};
 const resolve=(key:FieldName,choice:'mine'|'saved')=>{if(current.current)commit(resolveField(current.current,key,choice));};
 const saved=(submitted:Item,item:Item)=>{setRecovered(false);return commit(current.current?acknowledgeSave(current.current,submitted,item):openEditor(item));};
 return {current,form:editor?.draft??null,base:editor?.base??null,conflicts:editor?.conflicts??[],dirty:editor?editorDirty(editor):false,storageError,recovered,receive,edit,editMany,resolve,saved};
}
