/** JSON-only bridge for bundled JavaScriptCore. Same planner as the desktop prototype. */
import {GuidedOrbit,type OrbitFrame,type V3} from './guided-orbit.js';
let planner=new GuidedOrbit();
export function initialise(count:number,arcDegrees:180|360=360):void {planner=new GuidedOrbit(count,arcDegrees,arcDegrees===180);}
export function setCentre(json:string):void {
 const v=JSON.parse(json) as {centre:V3;radius:number;segment:string;frontAzimuth?:number};
 planner.setCentre(v.centre,v.radius,v.segment,v.frontAzimuth);
}
export function evaluateFrame(json:string):string {return JSON.stringify(planner.update(JSON.parse(json) as OrbitFrame));}
export function evaluateDiagnosticFrame(json:string):string {return JSON.stringify(planner.update(JSON.parse(json) as OrbitFrame,false));}
export function acknowledge(token:number,generation:number,saved:boolean):boolean {return planner.acknowledge(token,generation,saved);}
export function coverage():string {return JSON.stringify(planner.coverage());}

/** Experimental, relative image checks; never anatomical or scale validation. */
interface HeadSample {timestamp:number;pixels:number[];framed:boolean;cameraStill:boolean}
let reference:number|null=null,calibration:number[]=[],previous:HeadSample|null=null;
export function resetQuality():void {reference=null;calibration=[];previous=null;}
export function evaluateQuality(json:string):string {
 const s=JSON.parse(json) as HeadSample;
 const unknown={sharp:null,exposed:null,framed:s.framed,subjectStill:null,reference,calibrating:reference===null};
 if(!s.framed||!Number.isFinite(s.timestamp)||s.pixels.length!==1024||s.pixels.some(v=>!Number.isFinite(v)||v<0||v>255)){previous=null;return JSON.stringify(unknown);}
 const mean=s.pixels.reduce((a,b)=>a+b,0)/1024;
 const dark=s.pixels.filter(v=>v<8).length/1024,bright=s.pixels.filter(v=>v>247).length/1024;
 let sum=0,squares=0,n=0;
 for(let y=1;y<31;y++)for(let x=1;x<31;x++){const i=y*32+x,lap=s.pixels[i-1]!+s.pixels[i+1]!+s.pixels[i-32]!+s.pixels[i+32]!-4*s.pixels[i]!;sum+=lap;squares+=lap*lap;n++;}
 const sharpness=Math.max(0,squares/n-(sum/n)**2),exposed=dark<.4&&bright<.25;
 const prior=previous;previous=s;
 const continuous=prior!==null&&s.timestamp>prior.timestamp&&s.timestamp-prior.timestamp<=.25&&s.cameraStill&&prior.cameraStill;
 const oldMean=prior?prior.pixels.reduce((a,b)=>a+b,0)/1024:0;
 const difference=continuous?s.pixels.reduce((a,v,i)=>a+Math.abs((v-mean)-(prior!.pixels[i]!-oldMean)),0)/1024:null;
 const still=difference===null?null:difference<14;
 if(reference===null&&s.cameraStill&&still===true&&exposed&&sharpness>=12){calibration.push(sharpness);if(calibration.length>=12)reference=[...calibration].sort((a,b)=>a-b)[Math.floor(calibration.length/2)]!;}
 return JSON.stringify({sharp:reference===null?null:sharpness>=Math.max(12,reference*.35),exposed,framed:true,subjectStill:still,
  reference,calibrating:reference===null,calibrationFrames:calibration.length,sharpnessScore:sharpness,darkFraction:dark,brightFraction:bright,difference});
}
