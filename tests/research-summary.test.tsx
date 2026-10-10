import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {ResearchSummary} from '../src/ResearchSummary';
import type {Research} from '../shared/domain';
const report:Research={text:'Report',sources:[],researchedAt:'2026-09-27',identity:{name:'Instant Pot Duo · capacity unknown',confidence:'high',evidence:'Visible marking',nextPhotos:[]},pricing:{currency:'USD',low:25,high:50,suggested:40,quickSale:30,confidence:'low',basis:'category_estimate',reason:'Broad used-cooker estimate.',assumptions:['Working, complete; capacity unconfirmed.'],sourceUrls:[],channel:'local_pickup'}};
it('shows identity, recommendation, range, assumptions and the difference from a guaranteed sale',()=>{const html=renderToStaticMarkup(<ResearchSummary research={report} onUsePrice={()=>{}}/>);for(const value of ['Instant Pot Duo','Suggested asking price','$40.00','$25.00–$50.00','$30.00','Low confidence','no usable price comparisons','capacity unconfirmed','not a guaranteed sale','Save details'])expect(html).toContain(value);});
it('old reports clearly explain how to get a price',()=>{const html=renderToStaticMarkup(<ResearchSummary research={{text:'Old report',sources:[],researchedAt:'2026-09-25'}} onUsePrice={()=>{}}/>);expect(html).toContain('Research photos again');expect(html).not.toContain('Use $');});
it('disables applying a price while another edit needs attention',()=>{expect(renderToStaticMarkup(<ResearchSummary research={report} disabled onUsePrice={()=>{}}/>)).toContain('disabled');});
