export type UUID = string;
export type Timestamp = string;
export type Quantity = string;
export type Unit = 'g' | 'ml' | 'pcs';
export type Meta = {serverTime: Timestamp; requestId: UUID};
export type Envelope<T> = {data:T; meta:Meta};
export type Page<T> = {items:T[]; page:number; pageSize:number; total:number};
export type ApiError = {error:{code:string; message:string; details:{fields?:{path:string;message:string}[]}}; meta:Meta};
export type IntegrationIdentity = {clientId:UUID; warehouseId:UUID; name:string; kind:'supplier'|'pos'};
export type CatalogIngredient = {id:UUID; name:string; unit:Unit};
export type PurchaseRequestStatus = 'draft'|'submitted'|'approved'|'delivery_pending'|'received'|'rejected'|'cancelled'|'delivery_rejected';
export type PurchaseRequestInput = {supplierClientId:UUID; expectedAt:Timestamp|null; note:string|null; lines:{ingredientId:UUID;quantity:Quantity}[]};
export type PurchaseRequest = {
 id:UUID; number:string; warehouseId:UUID; version:number; supplierClientId:UUID; supplierName:string; status:PurchaseRequestStatus;
 createdAt:Timestamp; submittedAt:Timestamp|null; approvedAt:Timestamp|null; closedAt:Timestamp|null; expectedAt:Timestamp|null;
 note:string|null; rejectionReason:string|null; deliveryId:UUID|null;
 lines:{ingredientId:UUID;ingredientName:string;unit:Unit;quantity:Quantity}[];
};
export type DeliveryLineInput = {ingredientId:UUID;quantity:Quantity;expiresAt:Timestamp} | {ingredientId:UUID;quantity:Quantity;manufacturedAt:Timestamp;shelfLifeHours?:number};
export type DeliveryInput = {number:string;expectedAt:Timestamp|null;note:string|null;lines:DeliveryLineInput[]};
export type ExternalDeliveryInput = DeliveryInput & {externalId:string;purchaseRequestId?:UUID|null};
export type SupplierDelivery = {
 id:UUID; number:string; createdAt:Timestamp; expectedAt:Timestamp|null; receivedAt:Timestamp|null; status:'pending'|'confirmed'|'rejected';
 source:'manual'|'integration';externalId:string|null;purchaseRequestId:UUID|null;note:string|null;rejectedAt:Timestamp|null;rejectionReason:string|null;
 lines:{id:UUID;ingredientId:UUID;ingredientName:string;unit:Unit;quantity:Quantity;manufacturedAt:Timestamp|null;shelfLifeHours:number;expiresAt:Timestamp}[];
};
