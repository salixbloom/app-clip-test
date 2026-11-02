import {describe,it,expect} from 'vitest';
import {GuidedOrbit,orbitSlots,type OrbitFrame} from './guided-orbit.js';
const frame=(t:number,patch:Partial<OrbitFrame>={}):OrbitFrame=>({id:String(t),timestamp:t,segment:'a',position:[0,0,1],forward:[0,0,-1],tracking:'normal',sharp:true,exposed:true,framed:true,subjectStill:true,...patch});
function planner(){const p=new GuidedOrbit();p.setCentre([0,0,0],1,'a');return p;}
function dwell(p:GuidedOrbit,start=0,patch:Partial<OrbitFrame>={}){let result=p.update(frame(start,patch));for(let i=1;i<=9&&!result.ticket;i++)result=p.update(frame(start+i*.1,patch));return result;}
describe('two-person guided capture',()=>{
 it('covers only the front half including both profiles, in any world heading',()=>{
  for(const count of [24,64,72,128]){
   const p=new GuidedOrbit(count,180),heading=2.8;p.setCentre([2,1,-3],1,'a',heading);
   const slots=orbitSlots(count,180);
   for(const band of new Set(slots.map(s=>s.elevation))){const row=slots.filter(s=>s.elevation===band);expect(row[0]!.azimuth).toBeCloseTo(-Math.PI/2);expect(row.at(-1)!.azimuth).toBeCloseTo(Math.PI/2);}
   let t=0;
   for(const slot of slots){
    const a=slot.azimuth+heading,e=slot.elevation,offset=[Math.sin(a)*Math.cos(e),Math.sin(e),Math.cos(a)*Math.cos(e)] as const;
    const r=dwell(p,t,{position:[2+offset[0],1+offset[1],-3+offset[2]],forward:[-offset[0],-offset[1],-offset[2]]});
    expect(r.ticket?.slot).toBe(slot.id);p.acknowledge(r.ticket!.token,r.ticket!.generation,true);t+=2;
   }
   expect(p.coverage().filter(Boolean)).toHaveLength(count);expect(p.update(frame(t)).message).toBe('Capture complete');
  }
 });
 it('never issues front-half tickets from the unobserved rear',()=>{
  const p=new GuidedOrbit(24,180);p.setCentre([0,0,0],1,'a');
  expect(dwell(p,0,{position:[0,0,-1],forward:[0,0,1]}).ticket).toBeNull();
 });
 it('does not call an unavailable movement detector detected movement',()=>{
  expect(planner().update(frame(0,{subjectStill:null})).message).toContain('unavailable');
  expect(planner().update(frame(0,{subjectStill:false})).message).toContain('Subject moved');
 });
 it('allows manual preview with unknown quality but never auto-captures or changes coverage',()=>{
  const p=planner();
  for(let i=0;i<20;i++){
   const result=p.update(frame(i*.1,{subjectStill:null,framed:null,sharp:null,exposed:null}),false);
   expect(result.message).toBe('Ready for a manual photo');expect(result.ticket).toBeNull();
  }
  expect(p.coverage().some(Boolean)).toBe(false);
  expect(p.update(frame(3,{tracking:'limited'}),false).message).toContain('tracking');
 });
 it('allocates exactly the requested number of evenly spaced positions',()=>{for(const count of [24,64,72,128]){const slots=orbitSlots(count);expect(slots).toHaveLength(count);for(const elevation of new Set(slots.map(s=>s.elevation))){const band=slots.filter(s=>s.elevation===elevation);for(let i=1;i<band.length;i++)expect(band[i]!.azimuth-band[i-1]!.azimuth).toBeCloseTo(2*Math.PI/band.length);}}expect(()=>orbitSlots(129)).toThrow();});
 it('requires explicit centre and acceptable tracking/quality for every frame',()=>{
  expect(new GuidedOrbit().update(frame(0)).ticket).toBeNull();
  for(const patch of [{tracking:'limited' as const},{sharp:false},{exposed:null},{framed:false},{subjectStill:null},{position:[0,0,1.3] as const},{forward:[1,0,0] as const}])expect(dwell(planner(),0,patch).ticket).toBeNull();
 });
 it('issues one same-frame ticket and waits for durable acknowledgment',()=>{const p=planner(),r=dwell(p);expect(r.ticket).not.toBeNull();expect(r.ticket!.frame.timestamp).toBeCloseTo(.7);expect(p.coverage().filter(Boolean)).toHaveLength(0);expect(p.update(frame(1)).ticket).toBeNull();expect(p.acknowledge(r.ticket!.token,r.ticket!.generation,true)).toBe(true);expect(p.coverage().filter(Boolean)).toHaveLength(1);expect(p.acknowledge(r.ticket!.token,r.ticket!.generation,true)).toBe(false);expect(dwell(p,2).ticket).toBeNull();});
 it('retries failed storage and invalidates tickets on recentering or origin changes',()=>{const p=planner(),a=dwell(p).ticket!;p.acknowledge(a.token,a.generation,false);const b=dwell(p,2).ticket!;expect(b.token).not.toBe(a.token);p.setCentre([0,0,0],1,'a');expect(p.acknowledge(b.token,b.generation,true)).toBe(false);const c=dwell(p,4).ticket!;expect(p.update(frame(5,{segment:'b'})).message).toContain('origin changed');expect(p.acknowledge(c.token,c.generation,true)).toBe(false);});
 it('rejects jitter, gaps, duplicate timestamps and quality interruptions',()=>{
  const p=planner();p.update(frame(0));expect(p.update(frame(1)).message).toContain('continuous');p.update(frame(1.1));expect(p.update(frame(1.1)).message).toContain('continuous');
  for(let i=0;i<30;i++)expect(p.update(frame(2+i*.1,{position:[i%2*.01,0,1]})).ticket).toBeNull();
  p.update(frame(6));p.update(frame(6.1,{sharp:false}));expect(p.update(frame(6.2)).ticket).toBeNull();
 });
});
