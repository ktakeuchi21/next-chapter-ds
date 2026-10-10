import type {Media} from './domain';
export function orderedPhotoIds(ids:string[],media:Pick<Media,'id'|'kind'>[]){const selected=new Set(ids);return media.filter(m=>m.kind==='photo'&&selected.has(m.id)).map(m=>m.id);}
export function photoUrl(photo:Pick<Media,'id'|'revision'>,preview=false){return `/api/media/${photo.id}?revision=${photo.revision||1}${preview?'&preview=1':''}`;}
export function currentPhoto(row:any){return {key:row.edited_key||row.object_key,mime:row.edited_mime||row.mime,size:row.edited_size??row.size};}
