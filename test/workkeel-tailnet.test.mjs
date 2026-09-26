import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {startTailnetObserver} from '../src/workkeel-tailnet.mjs';

test('private observer authenticates owner, preserves loopback capability and rejects writes',async t=>{
  const token='a'.repeat(64),seen=[];
  const upstream=http.createServer((req,res)=>{seen.push({url:req.url,headers:req.headers});res.writeHead(200,{'Content-Type':req.url==='/'?'text/html':'application/json','Content-Security-Policy':"default-src 'none'"});res.end(req.url==='/'?'<html lang="zh-Hant"><body>Workkeel</body></html>':'{"ready":true}');});
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{upstream.close(resolve);upstream.closeAllConnections();}));
  const viewer=await startTailnetObserver({upstream:'http://127.0.0.1:'+upstream.address().port,accessToken:token,hostname:'test.example.ts.net',allowedLogin:'owner@example.com'});t.after(()=>viewer.close());
  const request=(url,headers={},method='GET')=>new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:viewer.port,path:url,method,headers:{host:'test.example.ts.net','tailscale-user-login':'owner@example.com',...headers}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString(),headers:res.headers}));});req.on('error',reject);req.end();});
  for(const h of [{'tailscale-user-login':'other@example.com'},{'tailscale-user-login':''},{host:'evil.example'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'}])assert.equal((await request('/api/workspace',h)).status,403);
  assert.equal((await request('/api/workspace',{},'POST')).status,405);
  assert.equal((await request('/api/diagnostics')).status,404);
  assert.equal((await request('//evil.example/api/workspace')).status,400);
  assert.equal((await request('/\\[')).status,400);
  assert.equal(seen.length,0);
  const html=await request('/');assert.equal(html.status,200);assert.match(html.body,/data-observer-auth="tailscale"/);assert(!html.body.includes(token));
  const data=await request('/api/workspace?q=one',{authorization:'Bearer hostile',cookie:'secret=anything',origin:'https://test.example.ts.net'});
  assert.equal(data.status,200);assert.equal(seen[1].headers.authorization,'Bearer '+token);assert.equal(seen[1].headers.cookie,undefined);assert.equal(seen[1].headers.origin,undefined);assert.equal(seen[1].headers.host,'127.0.0.1:'+upstream.address().port);assert.equal(data.headers['cache-control'],'no-store');
});

test('private observer refuses remote upstream and malformed identity configuration',async()=>{
  const config={upstream:'http://127.0.0.1:12345',accessToken:'b'.repeat(64),hostname:'test.example.ts.net',allowedLogin:'owner@example.com'};
  for(const invalid of [{upstream:'https://example.com'},{upstream:'http://u:p@127.0.0.1:12345/'},{hostname:'example.com'},{allowedLogin:''},{accessToken:'bad'},{port:-1}])await assert.rejects(startTailnetObserver({...config,...invalid}));
});
