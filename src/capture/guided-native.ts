/** JSON-only bridge for bundled JavaScriptCore. Same planner as the desktop prototype. */
import {GuidedOrbit,type OrbitFrame,type V3} from './guided-orbit.js';
let planner=new GuidedOrbit();
export function initialise(count:number):void {planner=new GuidedOrbit(count);}
export function setCentre(json:string):void {
 const v=JSON.parse(json) as {centre:V3;radius:number;segment:string};
 planner.setCentre(v.centre,v.radius,v.segment);
}
export function evaluateFrame(json:string):string {return JSON.stringify(planner.update(JSON.parse(json) as OrbitFrame));}
export function acknowledge(token:number,generation:number,saved:boolean):boolean {return planner.acknowledge(token,generation,saved);}
export function coverage():string {return JSON.stringify(planner.coverage());}
