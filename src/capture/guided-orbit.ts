/** Experimental two-person capture planner. Pure logic; no camera/network access. */
export type V3=readonly [number,number,number];
export interface OrbitFrame {
 readonly id:string; readonly segment:string; readonly timestamp:number;
 readonly position:V3; readonly forward:V3;
 readonly tracking:'normal'|'limited'|'unavailable';
 /** Each check must describe this image, not a cached earlier frame. */
 readonly sharp:boolean|null; readonly exposed:boolean|null;
 readonly framed:boolean|null; readonly subjectStill:boolean|null;
}
export interface OrbitSlot {readonly id:number;readonly azimuth:number;readonly elevation:number}
export interface CaptureTicket {readonly token:number;readonly generation:number;readonly slot:number;readonly frame:OrbitFrame}
export interface Guidance {readonly message:string;readonly completed:number;readonly total:number;readonly next:OrbitSlot|null;readonly ticket:CaptureTicket|null}
const sub=(a:V3,b:V3):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const length=(v:V3)=>Math.hypot(...v);
const dot=(a:V3,b:V3)=>a.reduce((s,v,i)=>s+v*b[i]!,0);
const unit=(v:V3):V3=>{const n=length(v);return [v[0]/n,v[1]/n,v[2]/n];};
const angle=(a:V3,b:V3)=>Math.acos(Math.max(-1,Math.min(1,dot(unit(a),unit(b)))));
const wrap=(a:number)=>Math.atan2(Math.sin(a),Math.cos(a));
const radians=(degrees:number)=>degrees*Math.PI/180;
const finite=(v:V3)=>v.length===3&&v.every(Number.isFinite);
export function orbitSlots(total=72,arcDegrees:180|360=360):readonly OrbitSlot[]{
 if(!Number.isInteger(total)||total<24||total>128)throw new Error('Choose 24–128 capture positions');
 const slots:OrbitSlot[]=[];
 for(let band=0;band<3;band++){const count=Math.floor(total/3)+(band<total%3?1:0);for(let j=0;j<count;j++)slots.push({id:slots.length,azimuth:arcDegrees===180?-Math.PI/2+Math.PI*j/(count-1):2*Math.PI*j/count,elevation:radians([-15,0,15][band]!)});}
 return slots;
}
export class GuidedOrbit {
 readonly slots:readonly OrbitSlot[];
 private centre:V3|null=null;private radius=1;private frontAzimuth=0;private segment='';private generation=0;private sequence=0;
 private done=new Set<number>();private pending:CaptureTicket|null=null;
 private previous:OrbitFrame|null=null;private anchor:OrbitFrame|null=null;private activeSlot=-1;
 constructor(total=72,private readonly arcDegrees:180|360=360,private readonly handheld=false){this.slots=orbitSlots(total,arcDegrees);}
 /** Explicit confirmation required: a screen tap alone cannot determine depth. Resets coverage. */
 setCentre(centre:V3,radiusMetres:number,segment:string,frontAzimuth=0):void {
  if(!finite(centre)||!Number.isFinite(radiusMetres)||radiusMetres<.5||radiusMetres>1.5||!segment)throw new Error('Invalid confirmed scan centre');
  if(!Number.isFinite(frontAzimuth))throw new Error('Invalid front direction');
  this.centre=[...centre];this.radius=radiusMetres;this.frontAzimuth=frontAzimuth;this.segment=segment;this.generation++;this.done.clear();this.pending=null;this.pause();
 }
 private pause():void {this.previous=null;this.anchor=null;this.activeSlot=-1;}
 /** Mark complete only after the exact ticket image and metadata are durably saved. */
 acknowledge(token:number,generation:number,saved:boolean):boolean {
  if(!this.pending||this.pending.token!==token||this.pending.generation!==generation)return false;
  if(saved)this.done.add(this.pending.slot);this.pending=null;this.pause();return true;
 }
 coverage():readonly boolean[]{return this.slots.map(s=>this.done.has(s.id));}
 update(frame:OrbitFrame,captureEnabled=true):Guidance {
  const result=(message:string,next:OrbitSlot|null=null,ticket:CaptureTicket|null=null):Guidance=>({message,completed:this.done.size,total:this.slots.length,next,ticket});
  const refuse=(message:string,next:OrbitSlot|null=null)=>{this.pause();return result(message,next);};
  if(!this.centre)return refuse('Set and confirm the scan centre');
  if(frame.segment!==this.segment){this.centre=null;this.generation++;this.pending=null;return refuse('Tracking origin changed — set scan centre again');}
  if(this.pending)return result('Saving photo — hold still');
  if(this.done.size===this.slots.length)return result('Capture complete');
  if(!Number.isFinite(frame.timestamp)||!frame.id||!finite(frame.position)||!finite(frame.forward)||length(frame.forward)<.9)return refuse('Waiting for valid camera data');
  if(frame.tracking!=='normal')return refuse('Pause — camera tracking needs to recover');
  const offset=sub(frame.position,this.centre),distance=length(offset);
  if(distance<1e-6)return refuse('Move away from the scan centre');
  const azimuth=wrap(Math.atan2(offset[0],offset[2])-this.frontAzimuth),elevation=Math.atan2(offset[1],Math.hypot(offset[0],offset[2]));
  const candidates=this.slots.filter(s=>!this.done.has(s.id));
  const score=(s:OrbitSlot)=>wrap(azimuth-s.azimuth)**2+(elevation-s.elevation)**2;
  const next=candidates.reduce((best,s)=>score(s)<score(best)?s:best,candidates[0]!);
  if(Math.abs(distance-this.radius)>.12)return refuse(distance>this.radius?'Move closer':'Move farther away',next);
  if(angle(frame.forward,sub(this.centre,frame.position))>radians(8))return refuse('Aim at the centre of the head',next);
  // Manual preview never invents passing detector results or issues an auto ticket.
  if(!captureEnabled){this.pause();return result('Ready for a manual photo',next);}
  if(frame.subjectStill===null)return refuse('Subject motion check unavailable — use manual capture',next);
  if(frame.subjectStill!==true)return refuse('Subject moved or image changed — pause briefly',next);
  if(frame.framed===null)return refuse('Head framing check unavailable — use manual capture',next);
  if(frame.framed!==true)return refuse('Keep the entire head in frame',next);
  if(frame.exposed===null)return refuse('Exposure check unavailable — use manual capture',next);
  if(frame.exposed!==true)return refuse('Adjust lighting — avoid dark areas and glare',next);
  if(frame.sharp===null)return refuse('Sharpness check unavailable — use manual capture',next);
  if(frame.sharp!==true)return refuse('Wait for a sharp image',next);
  const perBand=this.slots.filter(s=>s.elevation===next.elevation).length;
  const spacing=this.arcDegrees===180?Math.PI/(perBand-1):2*Math.PI/perBand;
  if(Math.abs(wrap(azimuth-next.azimuth))>spacing*(this.arcDegrees===180?.45:.32))return refuse('Move around the subject toward the next marker',next);
  if(Math.abs(elevation-next.elevation)>radians(5))return refuse(elevation<next.elevation?'Raise the camera':'Lower the camera',next);
  const prev=this.previous;this.previous={...frame,position:[...frame.position],forward:[...frame.forward]};
  if(!prev||this.activeSlot!==next.id){this.activeSlot=next.id;this.anchor=this.previous;return result('Hold camera still',next);}
  const dt=frame.timestamp-prev.timestamp;
  if(dt<=0||dt>.25||frame.id===prev.id){this.pause();return result('Waiting for a continuous camera stream',next);}
  if(length(sub(frame.position,prev.position))/dt>(this.handheld?.08:.025)||angle(frame.forward,prev.forward)/dt>radians(this.handheld?6:2)){
   this.anchor=this.previous;return result('Hold camera still',next);
  }
  const anchor=this.anchor!;
  if(length(sub(frame.position,anchor.position))>(this.handheld?.012:.006)||angle(frame.forward,anchor.forward)>radians(this.handheld?1.5:.8)){this.anchor=this.previous;return result('Hold camera still',next);}
  if(frame.timestamp-anchor.timestamp<(this.handheld?.6:.7))return result('Hold camera still',next);
  const ticket:CaptureTicket={token:++this.sequence,generation:this.generation,slot:next.id,frame:this.previous};
  // Keep private ticket separate from caller-owned objects.
  this.pending={...ticket,frame:{...ticket.frame,position:[...ticket.frame.position],forward:[...ticket.frame.forward]}};
  return result('Capture now',next,ticket);
 }
}
