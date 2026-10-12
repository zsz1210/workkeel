import test from 'node:test';
import assert from 'node:assert/strict';
import {classifierRoute} from '../src/workkeel-dispatch-classifier.mjs';
import {selectDispatchModel} from '../src/workkeel-dispatch.mjs';
const policy={schema_version:'workkeel.dispatch-policy/v1',models:[{alias:'small',provider:'local',model:'local-small',reasoning:null,data_classes:['public','internal']},{alias:'review',provider:'other',model:'review-large',reasoning:'high',data_classes:['public','internal']}],default_alias:'small',conservative_alias:'review',parallelism:2};
const result={classifier:'local-rules',model:'local-small',tier:'SIMPLE',model_called:false,selection_reason:'bounded mechanical change'};
test('local guarded advice selects an approved alias without inventing confidence',()=>{
 const route=classifierRoute(policy,result);assert.equal(route.classifier.eligible,true);assert.equal(route.classifier.confidence,undefined);
 assert.equal(selectDispatchModel(policy,route).model,'local-small');
 assert.equal(selectDispatchModel(policy,{...route,risk:'high'}).model,'review-large');
});
test('rejects network model classification, unavailable and ambiguous provider mappings',()=>{
 assert.throws(()=>classifierRoute(policy,{...result,model_called:true}),/Invalid/);
 assert.throws(()=>classifierRoute(policy,{...result,model:'unknown'}),/missing/);
 const duplicate={...policy,models:[...policy.models,{...policy.models[0],alias:'another',provider:'cloud'}]};
 assert.throws(()=>classifierRoute(duplicate,result),/ambiguous/);
 assert.equal(classifierRoute(duplicate,{...result,provider:'local'}).classifier.alias,'small');
});
