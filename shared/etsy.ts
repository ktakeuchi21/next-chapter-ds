export interface EtsyOption {id:string;label:string;}
export interface EtsySetup {
 status:'no_shop'|'setup_required'|'ready';
 shop:null|{id:string;name:string;currency:string;paymentsReady:boolean};
 shipping:EtsyOption[];processing:EtsyOption[];returns:EtsyOption[];issues:string[];
}
export interface EtsyTransfer {
 id:string;shopId:string;listingId:string|null;state:'ready'|'running'|'review_required'|'complete';
 step:'create'|'inventory'|'photos'|'verify';uploaded:number;total:number;message:string;
 draftVersion:number;sourceVersion:number;updatedAt:string;
}
