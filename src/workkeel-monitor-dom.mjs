// Update retained nodes in place: browser-owned disclosure, focus, selection,
// popover and scroll state survives. Keys are scoped to each parent.
const listeners=new WeakMap();
export function on(element,type,handler){
 let handlers=listeners.get(element);if(!handlers){handlers=new Map();listeners.set(element,handlers);}
 if(!handlers.has(type))element.addEventListener(type,event=>listeners.get(element).get(type)?.(event));
 handlers.set(type,handler);return element;
}
function key(node){
 if(node.nodeType!==1)return null;
 return node.id||node.dataset.key||node.dataset.taskId||node.dataset.learningId||
  (node.localName==='section'&&node.dataset.stage)||null;
}
function compatible(a,b){return a.nodeType===b.nodeType&&a.nodeName===b.nodeName&&key(a)===key(b);}
function patch(current,next){
 if(current===next)return;
 if(['copy-status','handoff-text'].includes(current.id))return;
 if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
 for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name)&&!preserve(current,attr.name))current.removeAttribute(attr.name);
 for(const attr of next.attributes)if(!preserve(current,attr.name)&&current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
 // Interactive handlers receive the current target rather than a detached draft.
 for(const [type,handler] of listeners.get(next)??[])on(current,type,handler);
 if(next.drawChart)current.drawChart=next.drawChart;
 reconcile(current,...next.childNodes);
 if(['input','select','textarea'].includes(current.localName)&&current!==current.ownerDocument.activeElement&&current.value!==next.value)current.value=next.value;
}
function preserve(node,name){return node.localName==='details'&&name==='open'||node.matches('.help-popover')&&name==='style'||node.closest('.help')&&name==='aria-expanded';}
export function reconcile(parent,...children){
 const old=[...parent.childNodes],used=new Set();let cursor=parent.firstChild;
 for(const next of children){
  const id=key(next);
  let current=id?old.find(item=>!used.has(item)&&key(item)===id&&compatible(item,next)):
   old.find(item=>!used.has(item)&&!key(item)&&compatible(item,next));
  if(!current){current=next;parent.insertBefore(current,cursor);}
  else {patch(current,next);if(current!==cursor){if(parent.moveBefore&&current.parentNode===parent)parent.moveBefore(current,cursor);else parent.insertBefore(current,cursor);}}
  used.add(current);cursor=current.nextSibling;
 }
 for(const item of old)if(!used.has(item))item.remove();
}
