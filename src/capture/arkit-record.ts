/** Versioned experimental native archive boundary; independent of frozen CaptureFrame. */
export interface ARKitRecord {
 schema:'arkit-image-record-v1';capturePurpose:'guided'|'diagnostic'|'sweep';sessionId:string;segment:string;frameId:string;timestamp:number;
 image:{file:string;width:number;height:number;sha256:string;orientation:'native-buffer';mirrored:false};
 cameraToWorld:number[];intrinsics:number[];matrixOrder:'column-major';units:'metres';
 axes:'arkit-right-handed-y-up-camera-negative-z-forward';tracking:'normal';
 scaleValidated:false;
 quality:{sharpnessScore:number|null;darkFraction:number|null;brightFraction:number|null;framed:boolean|null;subjectStill:boolean|null};
 slot:number;generation:number;
}
export function parseARKitRecord(value:unknown):ARKitRecord {
 const v=value as ARKitRecord;
 const fail=()=>{throw new Error('Invalid ARKit image record');};
 const id=(s:unknown)=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
 if(!v||v.schema!=='arkit-image-record-v1'||!id(v.sessionId)||!id(v.segment)||!id(v.frameId)||!Number.isFinite(v.timestamp)||v.timestamp<0)fail();
 if(v.capturePurpose!=='guided'&&v.capturePurpose!=='diagnostic'&&v.capturePurpose!=='sweep')fail();
 if(v.units!=='metres'||v.matrixOrder!=='column-major'||v.axes!=='arkit-right-handed-y-up-camera-negative-z-forward'||v.tracking!=='normal'||v.scaleValidated!==false)fail();
 const image=v.image;
 if(!image||image.file!=='image.jpg'||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||!(/^[a-f0-9]{64}$/).test(image.sha256)||image.orientation!=='native-buffer'||image.mirrored!==false)fail();
 const m=v.cameraToWorld,k=v.intrinsics;
 if(!Array.isArray(m)||m.length!==16||!m.every(Number.isFinite)||!Array.isArray(k)||k.length!==9||!k.every(Number.isFinite))fail();
 if(Math.abs(m[3]!)>1e-6||Math.abs(m[7]!)>1e-6||Math.abs(m[11]!)>1e-6||Math.abs(m[15]!-1)>1e-6)fail();
 for(let a=0;a<3;a++)for(let b=0;b<3;b++){let d=0;for(let i=0;i<3;i++)d+=m[a*4+i]!*m[b*4+i]!;if(Math.abs(d-(a===b?1:0))>1e-3)fail();}
 const determinant=m[0]!*(m[5]!*m[10]!-m[6]!*m[9]!)-m[4]!*(m[1]!*m[10]!-m[2]!*m[9]!)+m[8]!*(m[1]!*m[6]!-m[2]!*m[5]!);
 if(determinant<.999||k[0]!<=0||k[4]!<=0||[1,2,3,5].some(i=>Math.abs(k[i]!)>1e-6)||Math.abs(k[8]!-1)>1e-6||k[6]!<0||k[6]!>image.width||k[7]!<0||k[7]!>image.height)fail();
 if(!Number.isInteger(v.slot)||v.slot<0||v.slot>=128||!Number.isInteger(v.generation)||v.generation<1)fail();
 if(!v.quality)fail();
 for(const key of ['sharpnessScore','darkFraction','brightFraction'] as const){const x=v.quality[key];if(x!==null&&(!Number.isFinite(x)||x<0||(key!=='sharpnessScore'&&x>1)))fail();}
 for(const key of ['framed','subjectStill'] as const)if(v.quality[key]!==null&&typeof v.quality[key]!=='boolean')fail();
 return structuredClone(v);
}
/** Pixel projection for original native-buffer coordinates, before display rotation. */
export function projectARKitPoint(record:ARKitRecord,world:readonly[number,number,number]):readonly[number,number]|null {
 const m=record.cameraToWorld,k=record.intrinsics;
 const d=world.map((v,i)=>v-m[12+i]!);
 const p=[0,1,2].map(c=>d.reduce((s,v,i)=>s+v*m[c*4+i]!,0));
 if(p[2]!>=0)return null;
 // ARKit camera +Y up, image +Y down, forward -Z.
 return [k[0]!*p[0]!/-p[2]!+k[6]!,k[4]!*p[1]!/p[2]!+k[7]!];
}
/** Diagnostic captures must never be counted as quality-approved guided views. */
export function parseGuidedARKitRecord(value:unknown):ARKitRecord {
 const record=parseARKitRecord(value);
 if(record.capturePurpose==='diagnostic')throw new Error('Diagnostic frame is not a guided capture');
 if(record.capturePurpose==='sweep')throw new Error('Sweep frame requires explicit sweep import');
 return record;
}
