import type {Item} from '../shared/domain';
import type {OrderView} from '../shared/orders';
export function orderItemEligible(item:Item){return item.recordType!=='batch'&&['ready','listed'].includes(item.status)&&item.availability==='available'&&!item.pickup;}
export function orderAcceptanceIssue(order:OrderView,items:Item[],choices:Record<string,string>={}){
 if(order.environment==='sandbox')return 'Sandbox orders are for practice and cannot mark real inventory sold.';
 if(order.data.cancelled)return 'This order was cancelled. Review it in the marketplace.';
 if(order.data.payment!=='paid')return 'Wait until the marketplace confirms full payment.';
 if(order.data.fulfillment!=='unfulfilled')return 'Confirm in the marketplace that this order still needs fulfillment.';
 if(order.data.currency!=='USD')return 'This workspace currently handles USD orders only. Review this order in the marketplace.';
 if(order.lines.some(l=>choices[l.id]!==undefined&&choices[l.id]!==l.item_id))return 'Save each changed item match before accepting the order.';
 if(order.lines.some(l=>l.quantity!==1))return 'An order line has more than one item. Review quantities in the marketplace before proceeding.';
 if(order.lines.some(l=>!l.item_id))return 'Match each order line to an inventory item first.';
 if(new Set(order.lines.map(l=>l.item_id)).size!==order.lines.length)return 'Each order line needs a different inventory item.';
 if(order.lines.some(l=>!items.some(i=>i.id===l.item_id&&orderItemEligible(i))))return 'A matched item is not ready or is already reserved. Open it to review availability and pickup details.';
 return null;
}
