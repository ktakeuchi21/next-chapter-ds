import {it,expect} from 'vitest';
import {itemFields,type Item} from '../shared/domain';
import {orderAcceptanceIssue} from '../src/order-review';
import type {OrderView} from '../shared/orders';
const item={...itemFields.parse({availability:'available'}),id:'item',code:'TST-1',status:'ready',recordType:'item'} as Item;
const order={environment:'production',data:{payment:'paid',fulfillment:'unfulfilled',currency:'USD',cancelled:false},lines:[{id:'line',item_id:item.id,quantity:1}]} as OrderView;
it('requires saving a changed match before accepting the previously matched inventory item',()=>{expect(orderAcceptanceIssue(order,[item],{line:'different'})).toMatch(/Save each changed/);expect(orderAcceptanceIssue(order,[item],{line:'item'})).toBeNull();});
it('explains why unavailable, duplicate, and sandbox item assignments cannot proceed',()=>{expect(orderAcceptanceIssue(order,[{...item,status:'sold'}])).toMatch(/not ready/);expect(orderAcceptanceIssue({...order,lines:[...order.lines,{...order.lines[0],id:'second'}]},[item])).toMatch(/different inventory/);expect(orderAcceptanceIssue({...order,environment:'sandbox'},[item])).toMatch(/Sandbox/);});
it('explains payment, currency, and previous-fulfillment blockers before a failed submission',()=>{expect(orderAcceptanceIssue({...order,data:{...order.data,payment:'partial'}},[item])).toMatch(/full payment/);expect(orderAcceptanceIssue({...order,data:{...order.data,fulfillment:'fulfilled'}},[item])).toMatch(/still needs fulfillment/);expect(orderAcceptanceIssue({...order,data:{...order.data,currency:'CAD'}},[item])).toMatch(/USD/);});
