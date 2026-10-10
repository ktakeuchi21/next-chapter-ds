import {base,localWrangler} from '../tests/local-api.mjs';
export async function cleanup(id){
 if(!/^[a-f0-9-]{36}$/.test(id))throw new Error('Invalid test item ID.');
 const r=await fetch(`${base}/items/${id}`);if(!r.ok)return;const d=await r.json();
 if(!d.item.title.startsWith('Integration test')&&!d.item.title.startsWith('Browser test'))throw new Error('Refusing to remove non-test item.');
 const run=localWrangler;
 for(const m of d.media){run(['r2','object','delete',`next-chapter-media/items/${id}/${m.id}`,'--local']);if(m.kind==='photo'||m.kind==='video')run(['r2','object','delete',`next-chapter-media/items/${id}/${m.id}/preview`,'--local']);}
 run(['d1','execute','next-chapter','--local','--command',['facebook_handoffs','marketplace_drafts','activity','jobs','listings','media'].map(t=>`DELETE FROM ${t} WHERE item_id='${id}';`).join('\n')+`\nDELETE FROM items WHERE id='${id}';`]);
}
if(process.argv[2])await cleanup(process.argv[2]);
