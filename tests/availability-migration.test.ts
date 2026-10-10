import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
it('defaults only ordinary active captures, preserves unavailable/samples/sold, and is idempotent',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const name of ['0001_initial.sql','0002_visits.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const rows=[['capture','item','intake','unknown',null],['bulk','batch','review','unknown',null],['legacy','item','review',null,null],['sample','item','intake','unknown','sample-id'],['unavailable','item','intake','unavailable',null],['reserved','item','reserved','unknown',null],['sold','item','sold','unknown',null],['fulfilled','item','fulfilled','unknown',null],['archived','item','archived','unknown',null],['available','item','intake','available',null]];
  for(const [id,type,status,availability,sample] of rows)db.prepare('INSERT INTO items(id,code,record_type,status,data,sample_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,id,type,status,JSON.stringify({...(availability?{availability}:{}),notes:'Keep private notes',price:30}),sample,'before','before');
  const sql=readFileSync(new URL('../migrations/0008_capture_availability.sql',import.meta.url),'utf8');db.exec(sql);db.exec(sql);
  for(const [id,,,availability] of rows){const row=db.prepare('SELECT * FROM items WHERE id=?').get(id) as any;const changed=['capture','bulk','legacy'].includes(id!);expect(JSON.parse(row.data)).toEqual({availability:changed?'available':availability,notes:'Keep private notes',price:30});expect(row.version).toBe(changed?2:1);}
  expect(db.prepare('SELECT COUNT(*) AS n FROM activity').get()!.n).toBe(3);
 }finally{db.close();}
});
