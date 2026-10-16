import http from "node:http";
import {readFile,stat} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
const customer=resolve(process.env.CUSTOMER_DIST||"dist-demo"),admin=resolve("../frontend/dist-demo"),port=Number(process.env.PORT||4174);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".png":"image/png",".svg":"image/svg+xml",".json":"application/json"};
http.createServer(async(req,res)=>{const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);if(path==="/client"){res.writeHead(308,{Location:"/client/"});res.end();return;}if(path.startsWith("/api/")||path.startsWith("/integrations/")){res.writeHead(503,{"Content-Type":"application/json"});res.end(JSON.stringify({error:{code:"RETRY_LATER",message:"Live API не подключён",details:{}},meta:{serverTime:new Date().toISOString(),requestId:crypto.randomUUID()}}));return;}
const root=path.startsWith("/client/")?customer:admin;let file=path==="/mockServiceWorker.js"?resolve("public/mockServiceWorker.js"):resolve(root,"."+(root===customer?path.slice(7):path));if(path!=="/mockServiceWorker.js"&&!file.startsWith(root+sep)&&file!==root){res.writeHead(403);res.end();return;}
try{if((await stat(file)).isDirectory())file=resolve(file,"index.html");await stat(file);}catch{if(extname(path)){res.writeHead(404);res.end();return;}file=resolve(root,"index.html");}
try{res.writeHead(200,{"Content-Type":mime[extname(file)]||"application/octet-stream","Cache-Control":"no-store","Service-Worker-Allowed":"/"});res.end(await readFile(file));}catch{res.writeHead(404);res.end("Build the demo first");}}).listen(port,"127.0.0.1",()=>console.log(`Static portals: http://127.0.0.1:${port}/client/`));
