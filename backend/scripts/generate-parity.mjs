import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'frontend/package.json'));
const ts = require('typescript');
const source = path.join(root, 'packages/demo-api/src');
const output = path.join(root, 'backend/.artifacts/parity-modules');
fs.mkdirSync(output, {recursive:true}); fs.writeFileSync(path.join(output, 'package.json'), '{"type":"module"}');
for (const relative of ['domain/stock.ts','domain/quarantine.ts','domain/comboPlanner.ts','domain/stopForecast.ts','domain/riskReports.ts','domain/demoFixture.ts','shared/lib/decimal.ts']) {
  const js = ts.transpileModule(fs.readFileSync(path.join(source,relative),'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
    .replace(/from "(\.[^"]+)"/g,(_,p)=>`from "${p}.js"`);
  const file=path.join(output,relative.replace(/\.ts$/,'.js')); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,js);
}
const load=async file=>import(pathToFileURL(path.join(output,'domain',file+'.js')));
const {createForecastFixture}=await load('demoFixture'); const {stockPlan,inventory}=await load('stock');
const {jointPlan,recipeFingerprint,expandOrder,publicCombo}=await load('comboPlanner');
const {forecast}=await load('stopForecast'); const {riskReport}=await load('riskReports');
const now=Date.parse('2026-10-14T12:00:00.000Z');
const snapshot=createForecastFixture(now,'dddddddd-0000-4000-8000-000000000001');
const input={lines:snapshot.dishes.slice(0,2).map(d=>({dishId:d.id,portions:1}))};
const components=snapshot.dishes.slice(0,2).map(d=>({dishId:d.id,portions:1}));
const combo={id:'dddddddd-0000-4000-8000-000000008001',version:1,title:'Parity pair',components,status:'published',createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),recipeFingerprint:recipeFingerprint(components,snapshot.dishes),needsReview:false,pricingMode:'unpriced'};
const comboInput={lines:[{dishId:components[0].dishId,portions:1}],combos:[{comboId:combo.id,version:1,quantity:2}]};
snapshot.combos=[combo];
const reportInput={view:'period',from:'2026-10-13T12:00:00.000Z',to:'2026-10-14T12:00:00.000Z',page:1,pageSize:50};
const cohortInput={...reportInput,view:'cohort',from:'2026-10-01T12:00:00.000Z'};
const data={asOf:new Date(now).toISOString(),snapshot,input,comboInput,reportInput,cohortInput,
 expected:{inventory:inventory(snapshot.ingredients,snapshot.deliveries.flatMap(d=>d.batches),now).sort((a,b)=>a.ingredientName.localeCompare(b.ingredientName,'ru')||a.ingredientId.localeCompare(b.ingredientId)),
 preview:stockPlan(snapshot.ingredients,snapshot.dishes,snapshot.deliveries.flatMap(d=>d.batches),input,now),
 combo:publicCombo(combo,snapshot.dishes,snapshot.ingredients,snapshot.deliveries.flatMap(d=>d.batches),now),
 expanded:expandOrder(comboInput,snapshot.dishes,[combo]),
 comboPlan:jointPlan(snapshot.ingredients,snapshot.dishes,snapshot.deliveries.flatMap(d=>d.batches),snapshot.dishes.slice(0,3).map(d=>d.id),now,1),
 forecast:forecast({ingredients:snapshot.ingredients,dishes:snapshot.dishes,batches:snapshot.deliveries.flatMap(d=>d.batches),orders:snapshot.orders,observationStartedAt:snapshot.forecastObservationStartedAt,datasetKind:'observed',revision:1},now,14,48),
 period:riskReport({batches:snapshot.deliveries.flatMap(d=>d.batches),movements:snapshot.movements,writeOffs:snapshot.writeOffs,openingBalances:[],trackingStartedAt:snapshot.analyticsTrackingStartedAt},reportInput,now),
 cohort:riskReport({batches:snapshot.deliveries.flatMap(d=>d.batches),movements:snapshot.movements,writeOffs:snapshot.writeOffs,openingBalances:[],trackingStartedAt:snapshot.analyticsTrackingStartedAt},cohortInput,now)}};
const target=path.join(root,'backend/tests/fixtures/ts-parity.json'); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,JSON.stringify(data,null,2)+'\n');
console.log('Generated stock/combo/forecast/period/cohort fixtures from existing TypeScript kernels.');
