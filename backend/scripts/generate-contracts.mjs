import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ts=createRequire(path.join(root,'frontend/package.json'))('typescript');
const modules={};
for(const [name,relative] of [['core','packages/demo-api/src/shared/api/types.ts'],['extensions','packages/demo-api/src/shared/api/extensions.ts'],['offers','packages/demo-api/src/shared/api/offers.ts'],['portal','packages/portal-contracts/src/index.ts'],['customer','customer_frontend/src/shared/api/types.ts']]) {
 const file=ts.createSourceFile(relative,fs.readFileSync(path.join(root,relative),'utf8'),ts.ScriptTarget.Latest,true);
 modules[name]=new Map(file.statements.filter(ts.isTypeAliasDeclaration).map(n=>[n.name.text,n]));
}
const schemas={};
const schemaName=(module,name)=>module==='customer'?'Customer'+name:module==='portal'&&modules.core.has(name)?'Portal'+name:name;
function schema(node,module,parameters={}) {
 if(node.kind===ts.SyntaxKind.StringKeyword)return {type:'string'};
 if(node.kind===ts.SyntaxKind.NumberKeyword)return {type:'number'};
 if(node.kind===ts.SyntaxKind.BooleanKeyword)return {type:'boolean'};
 if(ts.isLiteralTypeNode(node)){const text=node.literal.getText();return text==='null'?{type:'null'}:{type:node.literal.kind===ts.SyntaxKind.StringLiteral?'string':text==='true'||text==='false'?'boolean':'number',const:JSON.parse(text.replace(/^'(.*)'$/,'"$1"'))};}
 if(ts.isArrayTypeNode(node))return {type:'array',items:schema(node.elementType,module,parameters)};
 if(ts.isUnionTypeNode(node))return {anyOf:node.types.map(n=>schema(n,module,parameters))};
 if(ts.isIntersectionTypeNode(node))return {allOf:node.types.map(n=>schema(n,module,parameters))};
 if(ts.isParenthesizedTypeNode(node))return schema(node.type,module,parameters);
 if(ts.isTypeLiteralNode(node)) {const properties={},required=[];for(const member of node.members){if(!ts.isPropertySignature(member))continue;const name=member.name.getText().replace(/["']/g,'');properties[name]=schema(member.type,module,parameters);if(!member.questionToken)required.push(name);}return {type:'object',properties,required,additionalProperties:false};}
 if(ts.isTypeReferenceNode(node)) {
  const name=node.typeName.getText();if(parameters[name])return parameters[name];
  if(name==='UUID')return {type:'string',format:'uuid'};
  if(name==='Timestamp')return {type:'string',format:'date-time'};
  if(name==='Quantity')return {type:'string',pattern:'^(0|[1-9][0-9]{0,8})(\\.[0-9]{1,3})?$'};
  if(['Pick','Omit','Partial'].includes(name)) {
    const base=schema(node.typeArguments[0],module,parameters);
    const resolved=base.$ref?schemas[base.$ref.split('/').at(-1)]:base;
    if(!resolved?.properties)return base;
    const result=structuredClone(resolved);const selected=node.typeArguments[1]?.getText().match(/["']([^"']+)["']/g)?.map(s=>s.slice(1,-1))||[];
    if(name==='Partial')result.required=[];
    else {for(const key of Object.keys(result.properties))if(name==='Pick'?!selected.includes(key):selected.includes(key))delete result.properties[key];result.required=result.required.filter(k=>k in result.properties);}
    return result;
  }
  const source=modules[module].has(name)?module:modules.extensions.has(name)?'extensions':modules.offers.has(name)?'offers':modules.core.has(name)?'core':modules.portal.has(name)?'portal':null;
  if(!source)throw Error('Unresolved '+name);
  const declaration=modules[source].get(name);
  if(declaration.typeParameters){const bindings={};declaration.typeParameters.forEach((p,index)=>bindings[p.name.text]=schema(node.typeArguments[index],module,parameters));return schema(declaration.type,source,bindings);}
  const target=schemaName(source,name);if(!(target in schemas)){schemas[target]={};schemas[target]=schema(declaration.type,source);}
  return {$ref:'#/components/schemas/'+target};
 }
 throw Error('Unsupported TS contract: '+node.getText());
}
for(const [module,types] of Object.entries(modules))for(const [name,node] of types){if(node.typeParameters||['UUID','Timestamp','Quantity'].includes(name))continue;const target=schemaName(module,name);if(!(target in schemas)){schemas[target]={};schemas[target]=schema(node.type,module);}}
schemas.AuthLogin={type:'object',properties:{username:{type:'string'},password:{type:'string'}},required:['username','password'],additionalProperties:false};
schemas.AuthRegister={type:'object',properties:{username:{type:'string',pattern:'^[a-zA-Z0-9_.-]{3,64}$'},password:{type:'string',minLength:12,maxLength:128},displayName:{type:'string',minLength:1,maxLength:120}},required:['username','password','displayName'],additionalProperties:false};
const directory=path.join(root,'backend/src/RestaurantManagement.WebApi/Contracts');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'schemas.json'),JSON.stringify(schemas,null,2)+'\n');
function flatten(node) {
 if(Array.isArray(node))return node.map(flatten);
 if(!node||typeof node!=='object')return node;
 if(node.allOf){const items=node.allOf.map(n=>n.$ref?schemas[n.$ref.split('/').at(-1)]:n).map(flatten);if(items.every(n=>n.type==='object'&&n.properties))return {type:'object',properties:Object.assign({},...items.map(n=>n.properties)),required:[...new Set(items.flatMap(n=>n.required||[]))],additionalProperties:false};}
 return Object.fromEntries(Object.entries(node).map(([k,v])=>[k,flatten(v)]));
}
for(const key of Object.keys(schemas))schemas[key]=flatten(schemas[key]);
schemas.ConfirmDeliveryInput={oneOf:schemas.ConfirmDeliveryInput.anyOf};
schemas.ManualOfferInput.properties.title={type:'string',minLength:1,maxLength:120};
schemas.ManualOfferInput.properties.publicText={anyOf:[{type:'string',maxLength:500},{type:'null'}]};
for(const name of ['ManualOffer','ManualOfferInput']) {
  for(const field of ['version','expectedVersion']) if(schemas[name].properties[field])schemas[name].properties[field]={type:'integer',minimum:1,maximum:9007199254740991};
}
fs.writeFileSync(path.join(directory,'schemas.json'),JSON.stringify(schemas,null,2)+'\n');
console.log('Generated '+Object.keys(schemas).length+' schemas from current three-interface contracts.');
