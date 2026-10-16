import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const {chromium}=require('playwright'),{expect}=require('@playwright/test');
const url='http://127.0.0.1:4197',password='isolated-fixes-only-password';
const browser=await chromium.launch(),contexts=[];
const context=async()=>{const c=await browser.newContext();contexts.push(c);return c;};
async function api(ctx,path,method='GET',body,allowFailure=false) {
 const headers={Origin:url};
 if(method!=='GET') {
  const auth=path.startsWith('/api/v2/customer/')?'/api/v2/customer':'/api/v2';
  headers['X-CSRF-TOKEN']=(await(await ctx.request.get(url+auth+'/auth/csrf')).json()).data.requestToken;
  const me=await ctx.request.get(url+auth+'/auth/me');if(me.ok())headers['X-Rims-Expected-User-Id']=(await me.json()).data.id;
  headers['Idempotency-Key']=crypto.randomUUID();
 }
 const response=await ctx.request.fetch(url+path,{method,data:body,headers});
 const value=response.status()===204?{}:await response.json();if(!allowFailure)assert.ok(response.ok(),path+': '+JSON.stringify(value));
 return {status:response.status(),data:value.data,error:value.error};
}
async function select(page,name){await page.goto(url+'/enterprises');await page.locator('section').filter({has:page.getByRole('heading',{name,exact:true})}).getByRole('button',{name:'Открыть предприятие',exact:true}).click();}
async function rejectedUpgrade(ctx,path,origin=url){
 const cookies=await ctx.cookies();
 return new Promise((resolve,reject)=>{
  const request=http.request(url+path,{headers:{Origin:origin,Cookie:cookies.map(c=>c.name+'='+c.value).join('; '),Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':Buffer.from(crypto.randomUUID()).subarray(0,16).toString('base64')}},response=>{response.resume();resolve(response.statusCode);});
  request.on('upgrade',(_,socket)=>{socket.destroy();reject(Error('Unauthorized upgrade accepted'));});request.on('error',reject);request.end();
 });
}
const checks=[];
try {
 const admin=await context();await api(admin,'/api/v2/auth/login','POST',{username:'fixes-admin',password});
 const owner=await context(),suffix=Date.now().toString(36),username='ws-owner-'+suffix,name='WebSocket isolated '+suffix;
 const user=(await api(owner,'/api/v2/auth/register','POST',{username,password,displayName:'Isolated WebSocket owner'})).data;
 const enterprise=(await api(admin,'/api/v2/enterprises','POST',{name,ownerUsername:username})).data;
 const warehouse=enterprise.warehouseId,w='/api/v2/warehouses/'+warehouse;
 const ingredient=(await api(owner,w+'/ingredients','POST',{name:'WS ingredient',unit:'g',defaultShelfLifeHours:1,reorderPoint:'0.000',targetStock:'1000.000'})).data;
 const dish=(await api(owner,w+'/dishes','POST',{name:'WS dish',active:true,recipe:[{ingredientId:ingredient.id,quantity:'50.000'}]})).data;
 async function receive(number,quantity,ingredientId=ingredient.id,expiresAt=new Date(Date.now()+3600000).toISOString()){
  const d=(await api(owner,w+'/deliveries','POST',{number,note:'Isolated WebSocket acceptance',expectedAt:null,lines:[{ingredientId,quantity,expiresAt}]})).data;
  await api(owner,w+'/deliveries/'+d.id+'/confirm','POST',{receivedAtMode:'server'});
 }
 await receive('WS-INITIAL','100.000');
 await api(owner,w+'/customer-publication','PATCH',{enabled:true});
 const customer=await context();await api(customer,'/api/v2/customer/auth/register','POST',{username:'ws-customer-'+suffix,password,displayName:'Isolated WebSocket customer'});
 const cart=await customer.newPage();await cart.goto(url+'/client/outlets/'+warehouse+'/menu');
 await cart.getByRole('button',{name:'Добавить +1',exact:true}).first().click();
 await cart.goto(url+'/client/outlets/'+warehouse+'/cart');
 await expect(cart.locator('[data-availability-state="connected"]')).toBeVisible();
 await expect(cart.getByRole('heading',{name:'WS dish',exact:true})).toBeVisible();
 const stop=await owner.newPage(),order=await owner.newPage();
 let stopSockets=0,orderSockets=0,menuGets=0;
 stop.on('websocket',ws=>{if(ws.url().includes('/availability/ws'))stopSockets++;});
 order.on('websocket',ws=>{if(ws.url().includes('/availability/ws'))orderSockets++;});
 order.on('request',r=>{if(r.method()==='GET'&&/\/(menu\/availability|service\/menu)\?/.test(r.url()))menuGets++;});
 await select(stop,name);await select(order,name);
 await stop.goto(url+'/stop-list');await order.goto(url+'/orders/new');
 await expect(stop.locator('[data-availability-state="connected"]')).toBeVisible();await expect(order.locator('[data-availability-state="connected"]')).toBeVisible();
 assert.equal(stopSockets,1);assert.equal(orderSockets,1,'One socket shared by queries and status in a page');
 await order.getByRole('button',{name:'Добавить в заказ',exact:true}).first().click();
 await expect(order.getByRole('article',{name:'В корзине: WS dish'})).toBeVisible();
 const started=Date.now();await api(owner,w+'/orders','POST',{lines:[{dishId:dish.id,portions:2}]});
 await expect(stop.getByText('WS dish',{exact:true})).toBeVisible({timeout:7000});
 await expect(order.getByRole('article',{name:'В корзине: WS dish'}).getByText('Блюдо сейчас в стоп-листе',{exact:true})).toBeVisible({timeout:7000});
 assert.equal(await order.getByLabel('Порции блюда 1',{exact:true}).inputValue(),'1');
 await expect(cart.getByText('Блюдо временно недоступно',{exact:true})).toBeVisible({timeout:7000});
 checks.push({name:'Other-client order updates stop-list and preserved cart',latencyMs:Date.now()-started});
 const rejected=await api(owner,w+'/orders','POST',{lines:[{dishId:dish.id,portions:1}]},true);assert.equal(rejected.status,409);assert.equal(rejected.error.code,'INSUFFICIENT_STOCK');
 await receive('WS-RESTOCK','200.000');
 await expect(stop.getByText('WS dish',{exact:true})).toHaveCount(0,{timeout:7000});
 await expect(order.getByRole('article',{name:'В корзине: WS dish'}).getByText('Доступно порций: 4',{exact:true})).toBeVisible({timeout:7000});
 await expect(cart.getByText('Блюдо временно недоступно',{exact:true})).toHaveCount(0,{timeout:7000});
 checks.push({name:'Customer cart receives availability changes and retains its dish'});
 checks.push({name:'Receipt restores availability in both clients'});
 const countBefore=menuGets;await order.waitForTimeout(16500);assert.equal(menuGets,countBefore,'Healthy stream disables 15-second menu polling');
 await expect(order.locator('[data-availability-state="connected"]')).toBeVisible();
 assert.equal(orderSockets,1,'Socket remains open beyond the HTTP 15-second timeout');
 checks.push({name:'Persistent socket; no periodic menu GET while healthy'});
 await owner.setOffline(true);await expect(order.locator('[data-availability-state="reconnecting"]')).toBeVisible({timeout:7000});
 await api(admin,w+'/orders','POST',{lines:[{dishId:dish.id,portions:4}]});
 await owner.setOffline(false);await expect(order.locator('[data-availability-state="connected"]')).toBeVisible({timeout:10000});
 await expect(order.getByRole('article',{name:'В корзине: WS dish'}).getByText('Блюдо сейчас в стоп-листе',{exact:true})).toBeVisible({timeout:7000});
 assert.equal(await order.getByLabel('Порции блюда 1',{exact:true}).inputValue(),'1');checks.push({name:'Offline/reconnect resync; cart retained'});
 const anonymous=await context(),path=w+'/availability/ws?userId='+user.id;
 assert.equal(await rejectedUpgrade(anonymous,path),401);
 assert.equal(await rejectedUpgrade(owner,path,'https://untrusted.invalid'),403);
 assert.equal(await rejectedUpgrade(owner,w+'/availability/ws?userId='+crypto.randomUUID()),409);
 assert.equal(await rejectedUpgrade(owner,'/api/v2/warehouses/eeeeeeee-0000-4000-8000-000000000001/availability/ws?userId='+user.id),404);
 checks.push({name:'Anonymous, foreign Origin, wrong user and other warehouse rejected'});
 const expIngredient=(await api(owner,w+'/ingredients','POST',{name:'WS expiring ingredient',unit:'g',defaultShelfLifeHours:1,reorderPoint:'0.000',targetStock:'100.000'})).data;
 await api(owner,w+'/dishes','POST',{name:'WS expiring dish',active:true,recipe:[{ingredientId:expIngredient.id,quantity:'10.000'}]});
 await receive('WS-EXPIRY','100.000',expIngredient.id,new Date(Date.now()+20000).toISOString());
 await expect(stop.getByText('WS expiring dish',{exact:true})).toHaveCount(0,{timeout:7000});
 await expect(stop.getByText('WS expiring dish',{exact:true})).toBeVisible({timeout:27000});
 checks.push({name:'Expiry changes stop-list without a stock mutation'});
 // Replenish a single portion; concurrent callers must still have one winner.
 await receive('WS-RACE','50.000');
 const race=await Promise.all([api(owner,w+'/orders','POST',{lines:[{dishId:dish.id,portions:1}]},true),api(admin,w+'/orders','POST',{lines:[{dishId:dish.id,portions:1}]},true)]);
 assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);checks.push({name:'Concurrent last-portion orders remain atomic'});
 // An existing stream must close after server-side session revocation.
 await api(owner,'/api/v2/auth/logout','POST');
 await expect(order.locator('[data-availability-state="connected"]')).toHaveCount(0,{timeout:14000});checks.push({name:'Session revocation stops the existing connection'});
 for(const page of [stop,order])assert.equal(await page.evaluate(async()=>(await navigator.serviceWorker.getRegistrations()).length),0);
 await mkdir('integration/.artifacts/availability-websocket',{recursive:true});
 const evidence={status:'PASS',utc:new Date().toISOString(),source:'real ASP.NET/PostgreSQL',warehouseId:warehouse,msw:false,checks};
 await writeFile('integration/.artifacts/availability-websocket/local.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
} catch(error) {await mkdir('integration/.artifacts/availability-websocket',{recursive:true});for(const c of contexts)for(const p of c.pages())await p.screenshot({path:'integration/.artifacts/availability-websocket/failure-'+contexts.indexOf(c)+'-'+c.pages().indexOf(p)+'.png',fullPage:true}).catch(()=>{});throw error;}
finally {await browser.close();}
