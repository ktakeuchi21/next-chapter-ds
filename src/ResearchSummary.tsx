import type {Research} from '../shared/domain';
import {money,priceBasisLabels,priceChannelLabels} from '../shared/pricing';

type Props={research:Research;disabled?:boolean;onUsePrice:(price:number)=>void};
export function ResearchSummary({research,disabled,onUsePrice}:Props){
 const price=research.pricing;
 return <div className="research-summary">
  {research.identity&&<div className="research-identity"><span className="tiny-label">LIKELY ITEM</span><h3>{research.identity.name}</h3><small>Identification confidence: {research.identity.confidence}. Confirm before listing.</small></div>}
  {price?<section aria-label="Suggested listing price" className="price-summary">
   <div className="price-numbers"><div><span>Suggested asking price</span><strong>{money(price.suggested)}</strong></div><div><span>Working range</span><b>{money(price.low)}–{money(price.high)}</b></div><div><span>For a quicker sale</span><b>{money(price.quickSale)}</b></div></div>
   <p className="price-confidence"><strong>{price.confidence[0].toUpperCase()+price.confidence.slice(1)} confidence</strong> · {priceBasisLabels[price.basis]}</p>
   <p>{price.reason}</p>
   {price.assumptions.length>0&&<div className="price-assumptions"><strong>This assumes:</strong><ul>{price.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul></div>}
   <small>{priceChannelLabels[price.channel]} · USD, item only. Shipping, tax and selling fees are separate. This is a suggested starting price, not a guaranteed sale.</small>
   <button disabled={disabled} onClick={()=>onUsePrice(price.suggested)}>Use {money(price.suggested)} as asking price</button>
   <small>Fills in your draft for review. Save details to keep it.</small>
   {price.sourceUrls.length>0&&<details className="price-sources"><summary>Price sources ({price.sourceUrls.length})</summary>{price.sourceUrls.map(url=><a key={url} href={url} target="_blank" rel="noreferrer">{research.sources.find(s=>{try{const u=new URL(s.url);for(const k of [...u.searchParams.keys()])if(k.startsWith('utm_'))u.searchParams.delete(k);u.hash='';return u.href===url;}catch{return false;}})?.title||'View price comparison'}</a>)}</details>}
  </section>:<p className="pricing-message">{research.pricingMessage||'This older report has no suggested listing price. Choose Research photos again to get a provisional price and its assumptions.'}</p>}
 </div>;
}
