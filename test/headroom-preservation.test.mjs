import test from 'node:test';
import assert from 'node:assert/strict';
import { preservesJsonValues as same } from '../src/headroom-adapter.mjs';

test('lossless proof retains complete JSON values, ordered arrays and duplicates', () => {
  assert.equal(same('{ "b": [1,1,2], "a": {"n":true,"z":null} }', '{"a":{"z":null,"n":true},"b":[1,1,2]}'), true);
  for (const bad of ['{"b":[1,2],"a":{"n":true,"z":null}}','{"b":[2,1,1],"a":{"n":true,"z":null}}','{"b":[1,1,2],"a":{"n":false,"z":null}}']) {
    assert.equal(same('{"b":[1,1,2],"a":{"n":true,"z":null}}',bad),false);
  }
  assert.equal(same('{"__proto__":1}', '{"__proto__":2}'),false);
  assert.equal(same('{"__proto__":1}', '{"__proto__":1}'),true);
});

test('lossless proof detects precision drift, numeric spelling changes and duplicate object keys', () => {
  for (const value of ['9007199254740993','1.1234567890123456789','1e999','-0']) assert.equal(same(value,value),true);
  for (const [a,b] of [['9007199254740993','9007199254740992'],['1.1234567890123456789','1.1234567890123457'],['1e999','1e998'],['-0','0'],['1.0','1'],['1e2','100'],['1','"1"']]) assert.equal(same(a,b),false);
  assert.equal(same('{"a":1,"a":2}','{"a":2}'),false);
  assert.equal(same('{"a":1,"\\u0061":2}','{"a":2}'),false);
  assert.equal(same('{"a":2}','{"a":1,"a":2}'),false);
});

test('typed tables preserve nested rows, exact integer lexemes and quoted Unicode CSV strings', () => {
  const source={files:[{path:'引用,"a"\r\n😀',size:12},{path:'',size:-1}]};
  const table='[2]{path:string,size:int}\n"引用,""a""\r\n😀",12\n,-1';
  assert.equal(same(JSON.stringify(source),JSON.stringify({files:table})),true);
  assert.equal(same('[{"id":9007199254740993}]','[1]{id:int}\n9007199254740993'),true);
  assert.equal(same('[{"id":9007199254740993}]','[1]{id:int}\n9007199254740992'),false);
  assert.equal(same('[{"s":"same"},{"s":"same"}]','[2]{s:string}\nsame\nsame'),true);
  assert.equal(same('[{"s":"same"},{"s":"same"}]','[1]{s:string}\nsame'),false);
});

test('literal strings resembling tables are never reinterpreted as original arrays', () => {
  const s='[1]{id:int}\n7';
  assert.equal(same(JSON.stringify({value:s}),JSON.stringify({value:s})),true);
  assert.equal(same(JSON.stringify({value:s}),'{"value":[{"id":7}]}'),false);
  assert.equal(same('"hello"','hello'),false);
});

test('unknown table forms, ambiguous schemas and malformed syntax fail closed', () => {
  for (const candidate of ['[1]{id:float}\n7','[1]{id:int,id:int}\n7,7','[2]{id:int}\n7','[1]{id:int}\n7,8','[1]{id:int}\n07','[1]{id:int}\n7\nextra','[1]{id:int}\n"7"garbage','[1]{id:int}\n"7','[1]{id:int}\n7\r','[{"id":7,}]','[{"id":7}] trailing']) assert.equal(same('[{"id":7}]',candidate),false,candidate);
  assert.equal(same('[{"s":"a"}]','[1]{s:string}\na"'),false);
  assert.equal(same('[{"s":"a"}]','[1]{s:string}\n"a"x'),false);
  assert.equal(same('not json','not json'),false);
  assert.equal(same('[1,]', '[1]'),false);
});

test('lossless parser bounds oversized and deeply nested content', () => {
  assert.equal(same('"'+ 'x'.repeat(1024*1024)+'"','"x"'),false);
  const deep='['.repeat(130)+'0'+']'.repeat(130);
  assert.equal(same(deep,deep),false);
  assert.equal(same(null,'null'),false);
});
