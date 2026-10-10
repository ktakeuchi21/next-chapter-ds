// Shared by scheduled/manual backups and restore validation. Originals remain immutable.
export function mediaAssets(media){return media.flatMap(m=>{
 if(!/^[a-f0-9-]{36}$/.test(m.id)||m.object_key!==`items/${m.origin_item_id||m.item_id}/${m.id}`||(m.preview_key&&m.preview_key!==m.object_key+'/preview'))throw Error('Invalid media inventory');
 const files=[{id:m.id,file:'media/'+m.id,sourceKey:m.object_key,size:m.size,mime:m.mime}];
 if(m.preview_key)files.push({id:m.id,preview:true,file:'media/'+m.id+'.preview',sourceKey:m.preview_key,mime:'image/jpeg'});
 if(m.edited_key){
  if(!m.edited_key.startsWith(m.object_key+'/edits/')||!/^[a-f0-9-]{36}$/.test(m.edited_key.slice((m.object_key+'/edits/').length))||!['image/png','image/jpeg'].includes(m.edited_mime)||!Number.isInteger(m.edited_size)||m.edited_size<=0||m.edited_preview_key!==m.edited_key+'/preview')throw Error('Invalid edited photo inventory');
  files.push({id:m.id,variant:'edited',file:'media/'+m.id+'.edited',sourceKey:m.edited_key,size:m.edited_size,mime:m.edited_mime},{id:m.id,variant:'edited-preview',file:'media/'+m.id+'.edited-preview',sourceKey:m.edited_preview_key,mime:'image/jpeg'});
 }else if(m.edited_preview_key||m.edited_mime||m.edited_size)throw Error('Incomplete edited photo inventory');
 return files;
});}
