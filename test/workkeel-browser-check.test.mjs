import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32,deflateSync} from 'node:zlib';
import {assertScreenshotPNG} from '../src/workkeel-browser-check.mjs';

const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(type,bytes) {
  const out=Buffer.alloc(bytes.length+12);out.writeUInt32BE(bytes.length);
  out.write(type,4);bytes.copy(out,8);out.writeUInt32BE(crc32(out.subarray(4,-4)),out.length-4);return out;
}
function png({width=2,height=2,filter=0,trailingCompressed=false}={}) {
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
  const pixels=Buffer.alloc(18);pixels[0]=filter;
  const compressed=Buffer.concat([deflateSync(pixels),...(trailingCompressed?[Buffer.from([1])]:[])]);
  return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',compressed),chunk('IEND',Buffer.alloc(0))]);
}
test('visual evidence requires a complete, bounded, decodable screenshot',()=>{
  const valid=png();assert.deepEqual(assertScreenshotPNG(valid),{width:2,height:2});
  const badCRC=Buffer.from(valid);badCRC[29]^=1;
  const highBitType=Buffer.from(valid);highBitType[12]|=128;highBitType.writeUInt32BE(crc32(highBitType.subarray(12,29)),29);
  for(const invalid of [signature,valid.subarray(0,-1),badCRC,highBitType,Buffer.concat([valid,Buffer.from([0])]),png({width:10000,height:10000}),png({width:3}),png({filter:5}),png({trailingCompressed:true})]) {
    assert.throws(()=>assertScreenshotPNG(invalid),/complete supported PNG/);
  }
});
