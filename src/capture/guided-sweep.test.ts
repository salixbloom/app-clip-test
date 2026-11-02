import {describe,it,expect} from 'vitest';
import {GuidedSweep,type SweepFrame} from './guided-sweep.js';
const frame=(id:number,az:number,el=0,patch:Partial<SweepFrame>={}):SweepFrame=>({id:String(id),segment:'a',timestamp:id/30,position:[Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)],forward:[-Math.sin(az)*Math.cos(el),-Math.sin(el),-Math.cos(az)*Math.cos(el)],tracking:'normal',sharp:true,exposed:true,framed:true,subjectStill:null,facePresent:true,sharpnessScore:100,sharpnessReference:100,...patch});
function setup(count=24){const p=new GuidedSweep(count);p.setCentre([0,0,0],1,'a');p.begin(1);return p;}
describe('continuous 30fps frame selection',()=>{
 it('selects near the centre of each sector without requiring dwell or fabricated subject stability',()=>{
  const p=setup(),saved:string[]=[],selected=new Map<string,number>();let i=0;
  for(let az=-Math.PI/2;az<=Math.PI/2;az+=Math.PI/1800){const f=frame(++i,az),r=p.update(f);if(r.keep)selected.set(f.id,az);if(r.ticket){saved.push(r.ticket.frameId);p.acknowledge(r.ticket.token,r.ticket.generation,true);}}
  const last=p.finish().ticket!;saved.push(last.frameId);p.acknowledge(last.token,last.generation,true);
  expect(saved).toHaveLength(8);expect(p.coverage().filter(Boolean)).toHaveLength(8);
  const row=p.slots.filter(s=>s.elevation===0);saved.forEach((id,j)=>expect(Math.abs(selected.get(id)!-row[j]!.azimuth)).toBeLessThan(Math.PI/180));
 });
 it('leaves blurred, unverified, clipped and poorly lit views missing for targeted retakes',()=>{
  for(const patch of [{sharp:false},{facePresent:null},{facePresent:false},{framed:false},{exposed:null}]){
   const p=setup();for(let i=0;i<30;i++)expect(p.update(frame(i,-Math.PI/2,0,patch)).keep).toBe(false);
   expect(p.finish().ticket).toBeNull();expect(p.coverage().some(Boolean)).toBe(false);
  }
 });
 it('flushes the last exact frame, acknowledges durable saves and retries only missing sectors',()=>{
  const p=setup();p.update(frame(0,-Math.PI/2));const t=p.finish().ticket!;
  expect(t.frameId).toBe('0');expect(p.coverage().some(Boolean)).toBe(false);
  p.acknowledge(t.token,t.generation,false);expect(p.coverage().some(Boolean)).toBe(false);
  p.begin(1);p.update(frame(2,-Math.PI/2));const retry=p.finish().ticket!;p.acknowledge(retry.token,retry.generation,true);
  p.begin(1);expect(p.update(frame(3,-Math.PI/2)).keep).toBe(false);
 });
 it('invalidates candidates and old acknowledgements on origin change or recenter',()=>{
  const p=setup();p.update(frame(0,-Math.PI/2));const t=p.finish().ticket!;
  p.setCentre([0,0,0],1,'a');expect(p.acknowledge(t.token,t.generation,true)).toBe(false);
  p.update(frame(1,-Math.PI/2));expect(p.update(frame(2,-Math.PI/2,0,{segment:'b'})).message).toContain('origin');expect(p.finish().ticket).toBeNull();
 });
 it('allocates all 128 targets across three passes and blocks rapid movement',()=>{
  const p=setup(128);for(let band=0;band<3;band++){
   p.begin(band);const row=p.slots.filter(s=>Math.abs(s.elevation-[-15,0,15][band]!*Math.PI/180)<1e-9);let i=band*10000;
   for(const slot of row){const r=p.update(frame(++i,slot.azimuth,slot.elevation,{timestamp:i}));if(r.ticket)p.acknowledge(r.ticket.token,r.ticket.generation,true);}
   const t=p.finish().ticket!;p.acknowledge(t.token,t.generation,true);
  }
  expect(p.coverage().every(Boolean)).toBe(true);
  const q=setup();q.update(frame(0,-Math.PI/2));expect(q.update(frame(1,-Math.PI/2+.1)).keep).toBe(false);
 });
});
