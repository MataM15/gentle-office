import test from 'node:test';
import assert from 'node:assert/strict';
import * as layoutModule from '../public/layout.mjs';

for(const width of [1440,700]) for(const count of [1,2,3,4,6]) test(`layout ${count} offices at ${width}px`,()=>{
  const layout=layoutModule.officeLayout(count,width);
  const columns=count===1?1:count===2?(width>=960?2:1):count<=4?2:width===1440?4:2;
  assert.deepEqual(layout,{columns,rows:Math.ceil(count/columns),side:count===1,sideBySide:count===1&&width>=960});
});
test('layout scaling retains single-office half steps and permits quarter steps for hubs',()=>{
  assert.equal(layoutModule.officeScale(.7,1),1);
  assert.equal(layoutModule.officeScale(1.8,1),1.5);
  assert.equal(layoutModule.officeScale(.2,2),.5);
  assert.equal(layoutModule.officeScale(.8,6),.75);
  assert.equal(layoutModule.officeScale(1.8,2),1.75);
  assert.equal(layoutModule.officeLayout(0,700).side,false);
});
test('multi-office layout picks the arrangement with the biggest offices',()=>{
  const {officeLayout}=layoutModule;
  assert.equal(officeLayout(2,1060,1780).columns,1);
  assert.equal(officeLayout(2,1900,900).columns,2);
  assert.deepEqual([officeLayout(4,1060,1780).columns,officeLayout(4,1060,1780).rows],[1,4]);
  assert.equal(officeLayout(4,1900,1000).columns,2);
  assert.equal(officeLayout(3,2600,600).columns,3);
});
