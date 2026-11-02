import {describe,it,expect} from 'vitest';
import * as bridge from './guided-native.js';
import {parseARKitRecord,parseGuidedARKitRecord,projectARKitPoint} from './arkit-record.js';
const fixture=()=>({schema:'arkit-image-record-v1',capturePurpose:'guided',sessionId:'session',segment:'origin1',frameId:'frame1',timestamp:1,image:{file:'image.jpg',width:640,height:480,sha256:'a'.repeat(64),orientation:'native-buffer',mirrored:false},cameraToWorld:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,1,1],intrinsics:[500,0,0,0,500,0,320,240,1],matrixOrder:'column-major',units:'metres',axes:'arkit-right-handed-y-up-camera-negative-z-forward',tracking:'normal',scaleValidated:false,quality:{sharpnessScore:100,darkFraction:0,brightFraction:0,framed:true,subjectStill:true},slot:0,generation:1});
describe('native capture boundary',()=>{
 it('uses fine pixel blur measurements instead of accepting coarse texture alone',()=>{
  bridge.resetQuality();const pixels=Array.from({length:1024},(_,i)=>i%2?170:80);
  for(let i=0;i<14;i++)bridge.evaluateQuality(JSON.stringify({timestamp:i*.1,pixels,framed:true,cameraStill:true,detailSharpness:100}));
  const blurred=JSON.parse(bridge.evaluateQuality(JSON.stringify({timestamp:1.4,pixels,framed:true,cameraStill:true,detailSharpness:1})));
  expect(blurred.reference).toBe(100);expect(blurred.sharp).toBe(false);
 });
 it('allows small handheld jitter in front-half mode without accepting continued movement',()=>{
  bridge.initialise(24,180);bridge.setCentre(JSON.stringify({centre:[0,0,0],radius:1,segment:'a'}));
  let ticket=null;
  for(let i=0;i<10&&!ticket;i++)ticket=JSON.parse(bridge.evaluateFrame(JSON.stringify({id:String(i),timestamp:i*.1,segment:'a',position:[-1,i%2?.002:-.002,0],forward:[1,0,0],tracking:'normal',sharp:true,exposed:true,framed:true,subjectStill:true}))).ticket;
  expect(ticket).not.toBeNull();
  bridge.initialise(24,180);bridge.setCentre(JSON.stringify({centre:[0,0,0],radius:1,segment:'a'}));
  for(let i=0;i<20;i++)expect(JSON.parse(bridge.evaluateFrame(JSON.stringify({id:String(i),timestamp:i*.1,segment:'a',position:[-1,i*.02,0],forward:[1,0,0],tracking:'normal',sharp:true,exposed:true,framed:true,subjectStill:true}))).ticket).toBeNull();
 });
 it('calibrates relative head image checks and refuses blur, clipping, image change and gaps',()=>{
  bridge.resetQuality();
  const pixels=Array.from({length:1024},(_,i)=>80+((i+Math.floor(i/32))%2)*90);
  const input=(timestamp:number,patch:Record<string,unknown>={})=>JSON.stringify({timestamp,pixels,framed:true,cameraStill:true,...patch});
  expect(JSON.parse(bridge.evaluateQuality(input(0))).subjectStill).toBeNull();
  let q;for(let i=1;i<=12;i++)q=JSON.parse(bridge.evaluateQuality(input(i*.1)));
  expect(q.calibrating).toBe(false);expect(q.sharp).toBe(true);expect(q.subjectStill).toBe(true);
  expect(JSON.parse(bridge.evaluateQuality(input(1.3,{pixels:Array(1024).fill(125)}))).sharp).toBe(false);
  expect(JSON.parse(bridge.evaluateQuality(input(1.4,{pixels:Array(1024).fill(0)}))).exposed).toBe(false);
  expect(JSON.parse(bridge.evaluateQuality(input(1.5))).subjectStill).toBe(false);
  expect(JSON.parse(bridge.evaluateQuality(input(3))).subjectStill).toBeNull();
  expect(JSON.parse(bridge.evaluateQuality(input(3.1,{framed:false}))).sharp).toBeNull();
  bridge.resetQuality();expect(JSON.parse(bridge.evaluateQuality(input(4))).reference).toBeNull();
 });
 it('does not calibrate on featureless, clipped, malformed or moving images',()=>{
  for(const patch of [{pixels:Array(1024).fill(125)},{pixels:Array(1024).fill(255)},{pixels:[10]},{cameraStill:false}]){
   bridge.resetQuality();for(let i=0;i<20;i++)expect(JSON.parse(bridge.evaluateQuality(JSON.stringify({timestamp:i*.1,pixels:Array.from({length:1024},(_,j)=>j%2?170:80),framed:true,cameraStill:true,...patch}))).reference).toBeNull();
  }
 });
 it('exposes a manual preview without fabricated quality or automatic tickets',()=>{
  bridge.initialise(24);bridge.setCentre(JSON.stringify({centre:[0,0,0],radius:1,segment:'a'}));
  const result=JSON.parse(bridge.evaluateDiagnosticFrame(JSON.stringify({id:'manual',timestamp:0,segment:'a',position:[0,0,1],forward:[0,0,-1],tracking:'normal',sharp:null,exposed:null,framed:null,subjectStill:null})));
  expect(result.message).toBe('Ready for a manual photo');expect(result.ticket).toBeNull();
 });
 it('keeps deliberate diagnostic saves separate from approved guided captures',()=>{
  const diagnostic={...fixture(),capturePurpose:'diagnostic'};
  expect(parseARKitRecord(diagnostic).capturePurpose).toBe('diagnostic');
  expect(()=>parseGuidedARKitRecord(diagnostic)).toThrow('Diagnostic');
  expect(parseARKitRecord({...fixture(),capturePurpose:'sweep'}).capturePurpose).toBe('sweep');
  expect(()=>parseGuidedARKitRecord({...fixture(),capturePurpose:'sweep'})).toThrow('Sweep');
  expect(parseGuidedARKitRecord(fixture()).capturePurpose).toBe('guided');
  expect(()=>parseARKitRecord({...fixture(),capturePurpose:undefined})).toThrow();
 });
 it('runs the planner through JSON and acknowledges the precise ticket',()=>{
  bridge.initialise(24);bridge.setCentre(JSON.stringify({centre:[0,0,0],radius:1,segment:'a'}));
  let ticket:{token:number;generation:number;frame:{id:string}}|null=null;
  for(let i=0;i<10&&!ticket;i++){const r=JSON.parse(bridge.evaluateFrame(JSON.stringify({id:String(i),timestamp:i*.1,segment:'a',position:[0,0,1],forward:[0,0,-1],tracking:'normal',sharp:true,exposed:true,framed:true,subjectStill:true})));ticket=r.ticket;}
  expect(ticket).not.toBeNull();expect(ticket!.frame.id).toBe('7');expect(JSON.parse(bridge.coverage()).some(Boolean)).toBe(false);
  expect(bridge.acknowledge(ticket!.token,ticket!.generation,true)).toBe(true);expect(JSON.parse(bridge.coverage()).filter(Boolean)).toHaveLength(1);
 });
 it('projects ARKit negative-Z-forward coordinates into native image pixels',()=>{
  const r=parseARKitRecord(fixture());expect(projectARKitPoint(r,[0,0,0])).toEqual([320,240]);expect(projectARKitPoint(r,[.1,.1,0])).toEqual([370,190]);expect(projectARKitPoint(r,[0,0,2])).toBeNull();
  const turned=parseARKitRecord({...fixture(),cameraToWorld:[0,0,-1,0,0,1,0,0,1,0,0,0,1,0,0,1]});
  expect(projectARKitPoint(turned,[0,.1,-.1])).toEqual([370,190]);
 });
 it('refuses mismatched axes, reflected poses, bad calibration and fabricated scale clearance',()=>{
  for(const change of [{units:'millimetres'},{scaleValidated:true},{image:{...fixture().image,file:'../image.jpg'}},{intrinsics:[0,0,0,0,500,0,320,240,1]},{cameraToWorld:[-1,0,0,0,0,1,0,0,0,0,1,0,0,0,1,1]}])expect(()=>parseARKitRecord({...fixture(),...change})).toThrow();
 });
});
