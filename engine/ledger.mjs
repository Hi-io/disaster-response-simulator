import {requireCondition} from '../contracts/actions.mjs';

export function available(resource) {return resource.quantity-resource.reserved-resource.floor;}
export function reserve(resource,quantity) {
  requireCondition(Number.isSafeInteger(quantity)&&quantity>0,'QUANTITY','Quantity must be a positive integer');
  requireCondition(quantity<=available(resource),'INSUFFICIENT_RESOURCE','Insufficient unreserved stock');resource.reserved+=quantity;resource.version++;
}
export function release(resource,quantity) {requireCondition(quantity<=resource.reserved,'RESERVATION','Invalid release');resource.reserved-=quantity;resource.version++;}
export function load(resource,quantity) {requireCondition(quantity<=resource.reserved,'RESERVATION','Stock was not reserved');resource.reserved-=quantity;resource.quantity-=quantity;resource.transferred+=quantity;resource.version++;}
export function checkResource(resource) {return Number.isSafeInteger(resource.quantity)&&resource.quantity>=0&&resource.reserved>=0&&resource.reserved<=resource.quantity&&resource.initial+resource.produced+resource.received===resource.quantity+resource.consumed+resource.lost+resource.transferred;}

export function createResource(id,owner,node,type,quantity,floor=0,extra={}) {return {id,owner,node,type,quantity,reserved:0,floor,initial:quantity,produced:0,received:0,consumed:0,lost:0,transferred:0,unit:type==='water'?'L':'unit',version:1,public:true,...extra};}

export function transition(record,next,allowed) {requireCondition((allowed[record.state]??[]).includes(next),'STATE_TRANSITION',`Cannot transition ${record.state} to ${next}`);record.state=next;record.version=(record.version??0)+1;}
export const COMMITMENT_STATES={offered:['reserved','rejected','expired','withdrawn'],reserved:['confirmed','expired','withdrawn','released'],confirmed:['dispatched','expired','withdrawn','released'],dispatched:['completed','failed'],completed:[],expired:[],withdrawn:[],rejected:[],released:[],failed:[]};
