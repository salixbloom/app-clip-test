/** Continuous front-arc selection. One bounded candidate buffer; no dwell requirement. */
import {orbitSlots,type OrbitFrame,type V3} from './guided-orbit.js';
export interface SweepFrame extends OrbitFrame {readonly facePresent:boolean|null;readonly sharpnessScore:number;readonly sharpnessReference:number}
export interface SweepTicket {readonly token:number;readonly generation:number;readonly slot:number;readonly frameId:string}
export interface SweepGuidance {message:string;keep:boolean;candidateSlot:number|null;ticket:SweepTicket|null;missing:readonly number[];completed:number;total:number}
const rad=(v:number)=>v*Math.PI/180;
const wrap=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));
export class GuidedSweep {
 readonly slots;
 private centre:V3|null=null;private radius=1;private front=0;private segment='';private generation=0;private sequence=0;private band=1;
 private done=new Set<number>();private pending:SweepTicket|null=null;
 private best:{frameId:string;slot:number;score:number}|null=null;
 private previous:SweepFrame|null=null;
 constructor(total=128){this.slots=orbitSlots(total,180);}
 setCentre(centre:V3,radius:number,segment:string,front=0):void {
  if(centre.length!==3||!centre.every(Number.isFinite)||!Number.isFinite(radius)||radius<.5||radius>1.5||!Number.isFinite(front)||!segment)throw Error('Invalid scan centre');
  this.centre=[...centre];this.radius=radius;this.front=front;this.segment=segment;this.generation++;this.done.clear();this.best=null;this.pending=null;this.previous=null;
 }
 begin(band:number):void {if(![0,1,2].includes(band))throw Error('Invalid height pass');if(this.best||this.pending)throw Error('Finish current pass first');this.band=band;this.previous=null;}
 coverage():readonly boolean[]{return this.slots.map(s=>this.done.has(s.id));}
 private response(message:string,keep=false,ticket:SweepTicket|null=null):SweepGuidance {
  return {message,keep,candidateSlot:this.best?.slot??null,ticket,missing:this.slots.filter(s=>s.elevation===rad([-15,0,15][this.band]!)&&!this.done.has(s.id)).map(s=>s.id),completed:this.done.size,total:this.slots.length};
 }
 private commit():SweepTicket|null {
  if(!this.best||this.pending)return null;
  const ticket={token:++this.sequence,generation:this.generation,slot:this.best.slot,frameId:this.best.frameId};
  this.best=null;this.pending=ticket;return {...ticket};
 }
 finish():SweepGuidance {return this.response('Pass stopped — review missing markers',false,this.commit());}
 acknowledge(token:number,generation:number,saved:boolean):boolean {
  if(!this.pending||this.pending.token!==token||this.pending.generation!==generation)return false;
  if(saved)this.done.add(this.pending.slot);this.pending=null;return true;
 }
 update(f:SweepFrame):SweepGuidance {
  if(!this.centre)return this.response('Confirm centre directly in front of the subject');
  if(f.segment!==this.segment){this.centre=null;this.best=null;this.pending=null;this.previous=null;this.done.clear();this.generation++;return this.response('Tracking origin changed — confirm centre again');}
  if(this.pending)return this.response('Saving selected frame');
  if(f.tracking!=='normal')return this.response('Pause sweep — tracking needs to recover');
  if(!f.id||!Number.isFinite(f.timestamp)||![...f.position,...f.forward].every(Number.isFinite))return this.response('Waiting for valid camera data');
  const d=f.position.map((v,i)=>v-this.centre![i]!) as unknown as V3,length=Math.hypot(...d),forwardLength=Math.hypot(...f.forward);
  if(length<.01||forwardLength<.9)return this.response('Waiting for valid camera data');
  const az=wrap(Math.atan2(d[0],d[2])-this.front),el=Math.atan2(d[1],Math.hypot(d[0],d[2]));
  const row=this.slots.filter(s=>s.elevation===rad([-15,0,15][this.band]!));
  const slot=row.reduce((a,b)=>Math.abs(az-a.azimuth)<Math.abs(az-b.azimuth)?a:b),spacing=Math.PI/(row.length-1);
  // Leave a sector before committing its best frame, even when the new frame is blurred.
  const ticket=this.best&&this.best.slot!==slot.id?this.commit():null;
  const result=(message:string,keep=false)=>this.response(message,keep,ticket);
  if(Math.abs(az)>Math.PI/2+spacing*.45)return result('Stay in the front half of the head');
  if(Math.abs(length-this.radius)>.15)return result(length>this.radius?'Move closer':'Move farther away');
  const aim=Math.acos(Math.max(-1,Math.min(1,-f.forward.reduce((s,v,i)=>s+v*d[i]!,0)/(forwardLength*length))));
  if(aim>rad(10))return result('Keep the head centred');
  if(Math.abs(el-slot.elevation)>rad(6))return result(el<slot.elevation?'Raise camera to this pass':'Lower camera to this pass');
  const prev=this.previous;this.previous={...f,position:[...f.position],forward:[...f.forward]};
  if(prev){const dt=f.timestamp-prev.timestamp;if(dt<=0||f.id===prev.id)return result('Waiting for a new camera frame');
   const speed=Math.hypot(...f.position.map((v,i)=>v-prev.position[i]!))/dt;
   if(dt<=.25&&speed>.25)return result('Move more slowly — keep sweeping');}
  if(this.done.has(slot.id))return result('This view is saved — continue to a missing marker');
  if(f.facePresent!==true)return result('Face not verified — keep the person in view');
  if(f.framed!==true)return result('Keep the whole head inside the frame');
  if(f.exposed!==true)return result('Improve lighting before continuing');
  if(f.sharp!==true)return result('Image too soft — slow down or improve light');
  if(!Number.isFinite(f.sharpnessScore)||!Number.isFinite(f.sharpnessReference)||f.sharpnessReference<=0)return result('Calibrate sharpness before sweeping');
  const score=1-Math.abs(az-slot.azimuth)/(spacing/2)+.15*Math.min(2,f.sharpnessScore/f.sharpnessReference);
  if(!this.best||score>this.best.score){this.best={slot:slot.id,frameId:f.id,score};return result('Sweep slowly — selecting the best frame',true);}
  return result('Sweep slowly — selecting the best frame');
 }
}
