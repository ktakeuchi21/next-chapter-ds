import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {PhotoResearch} from '../src/PhotoResearch';
import type {Detail} from '../shared/domain';
const detail={media:[{kind:'photo'}],jobs:[],research:null} as unknown as Detail;
const base={detail,aiConnected:true,busy:false,dirty:false,conflicted:false,pickupDirty:false,onResearch:()=>{},onReview:()=>{}};
describe('photo identification next step',()=>{
 it('offers identification without requiring a name or notes',()=>{const html=renderToStaticMarkup(<PhotoResearch {...base}/>);expect(html).toContain('Identify from photos');expect(html).toContain('A name and notes are optional');expect(html).not.toContain('disabled');});
 it('offers save and identify together for unfinished details',()=>{expect(renderToStaticMarkup(<PhotoResearch {...base} dirty/>)).toContain('Save &amp; identify from photos');});
 it('requires a still photo for a video-only capture',()=>{const html=renderToStaticMarkup(<PhotoResearch {...base} detail={{...detail,media:[{kind:'video'}] as any}}/>);expect(html).toContain('disabled');expect(html).toContain('research needs a still photo');});
 it('distinguishes a voice task from active photo research',()=>{const html=renderToStaticMarkup(<PhotoResearch {...base} detail={{...detail,jobs:[{kind:'notes',state:'running'}] as any}}/>);expect(html).toContain('voice note or another task is still processing');expect(html).not.toContain('Identifying your item…');});
 it('keeps pending research visible without a duplicate start button',()=>{const html=renderToStaticMarkup(<PhotoResearch {...base} detail={{...detail,jobs:[{kind:'research',state:'queued'}] as any}}/>);expect(html).toContain('role="status"');expect(html).toContain('Research is queued');expect(html).not.toContain('<button');});
 it('shows a retry with the actual failure reason',()=>{const html=renderToStaticMarkup(<PhotoResearch {...base} detail={{...detail,jobs:[{kind:'research',state:'failed',error:'Quota reached'}] as any}}/>);expect(html).toContain('Quota reached');expect(html).toContain('Try photo research again');});
 it('offers the report after completion',()=>{const html=renderToStaticMarkup(<PhotoResearch {...base} detail={{...detail,research:{text:'report',sources:[],researchedAt:'2026-09-27'}}}/>);expect(html).toContain('Your research is ready');expect(html).toContain('View research history');});
 it('blocks new research until conflicting edits are resolved',()=>{const html=renderToStaticMarkup(<PhotoResearch {...base} conflicted dirty/>);expect(html).toContain('disabled');expect(html).toContain('Resolve the competing edits');});
});
