import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const api=JSON.parse(fs.readFileSync(path.join(root,'openapi.json'),'utf8'));
if(api.openapi!=='3.1.0'||api.info.version!=='2.1.0')throw Error('Wrong OpenAPI version');
function visit(node){if(!node||typeof node!=='object')return;if(node.$ref){const target=node.$ref.slice(2).split('/').reduce((n,k)=>n?.[k],api);if(!target)throw Error('Unresolved reference '+node.$ref);}Object.values(node).forEach(visit);}
visit(api);
for(const [method,p] of [
 ['get','/api/v2/runtime'],['get','/api/v2/auth/csrf'],['post','/api/v2/auth/register'],
 ['get','/api/v2/warehouses/{warehouseId}/offers'],['get','/api/v2/warehouses/{warehouseId}/manual-offers'],
 ['post','/api/v2/warehouses/{warehouseId}/manual-offers'],['put','/api/v2/warehouses/{warehouseId}/manual-offers/{id}'],
 ['post','/api/v2/warehouses/{warehouseId}/manual-offers/{id}/publish'],['post','/api/v2/warehouses/{warehouseId}/manual-offers/{id}/unpublish'],['post','/api/v2/warehouses/{warehouseId}/manual-offers/{id}/archive'],
 ['get','/api/v2/warehouses/{warehouseId}/service/offers'],['get','/api/v2/customer/warehouses/{warehouseId}/offers'],['get','/integrations/v1/warehouses/{warehouseId}/offers'],
 ['get','/api/v2/warehouses/{warehouseId}/stop-list/forecast'],['get','/api/v2/warehouses/{warehouseId}/analytics/risk-inventory'],
 ['put','/api/v2/warehouses/{warehouseId}/purchase-requests/{id}'],['post','/api/v2/warehouses/{warehouseId}/quarantines/{id}/write-off'],
 ['post','/api/v2/customer/warehouses/{warehouseId}/orders'],['get','/api/v2/customer/outlets'],
 ['get','/integrations/v1/warehouses/{warehouseId}/identity'],['post','/integrations/v1/warehouses/{warehouseId}/purchase-requests/{id}/approve']
])if(!api.paths[p]?.[method])throw Error('Missing '+method+' '+p);
for(const p of Object.keys(api.paths))if(p.startsWith('/api/v1')||p.includes('/customer/warehouses/')&&/(inventory|batches|quarantines|analytics|service)/.test(p))throw Error('Unsafe public route '+p);
if(api.paths['/integrations/v1/warehouses/{warehouseId}/purchase-requests']?.post||api.paths['/api/v2/customer/warehouses/{warehouseId}/combos']?.post)throw Error('Unauthorized producer route');
if(api.components.schemas.ConfirmDeliveryInput?.oneOf?.length!==2)throw Error('Missing strict confirm union');
for(const p of Object.keys(api.paths))if((p.startsWith('/api/v2/customer/')||p.startsWith('/integrations/'))&&p.includes('manual-offers'))throw Error('Management offer route exposed publicly');
for(const [p,item]of Object.entries(api.paths))if(p.includes('/manual-offers'))for(const [method,op]of Object.entries(item))if(method!=='get'&&!op.parameters.some(p=>p.name==='Idempotency-Key'&&p.required))throw Error('Manual mutation without replay key');
console.log('PASS: references, version, required routes, safe portal surfaces, offer keys and confirm union; '+Object.keys(api.paths).length+' paths.');
