import { requireCondition as check } from './actions.mjs';

// Declared laboratory transport units, shared by every controller. These are
// normative model parameters, not empirical cargo dimensions or body weights.
const ordinary={massKgPerUnit:1,volumeM3PerUnit:0.001,seatsPerUnit:0};
export const CARGO_PROFILES=Object.freeze(Object.fromEntries(['water','food','blankets','fuel','rescue','sanitation','energy','staff']
  .map(type=>[type,Object.freeze(type==='energy'?{massKgPerUnit:150,volumeM3PerUnit:0.2,seatsPerUnit:0}:
    type==='staff'?{massKgPerUnit:75,volumeM3PerUnit:0.075,seatsPerUnit:1}:{...ordinary})])));
export const cargoProfile=type=>CARGO_PROFILES[type]??null;
export function cargoViolation(v,type,quantity,{passengers=v?.passengers??0,crew=v?.crewQuantity??0}={}){
  const p=cargoProfile(type);if(!p)return {code:'CARGO_PROFILE',reason:'Unknown physical transport unit'};
  if(!Number.isSafeInteger(quantity)||quantity<0)return {code:'QUANTITY',reason:'Physical cargo requires an exact nonnegative quantity'};
  if(quantity>(v.capacity??0))return {code:'CAPACITY',reason:'Vehicle cannot carry that quantity'};
  const people=passengers+crew;
  if(quantity*p.seatsPerUnit+people>(v.seats??0))return {code:'SEATS',reason:'Transported people exceed actual passenger seats'};
  if(quantity*p.massKgPerUnit>(v.maxCargoKg??Infinity))return {code:'WEIGHT',reason:'Cargo exceeds freight payload mass'};
  if(quantity*p.volumeM3PerUnit>(v.volumeM3??Infinity))return {code:'VOLUME',reason:'Cargo exceeds freight payload volume'};
  return null;
}
export function checkVehicleCargo(v,type,quantity,options){const e=cargoViolation(v,type,quantity,options);
  check(!e,e?.code,e?.reason);}
export function grossVehicleWeight(v){return (v.weightKg??0)+(v.load??0)*(cargoProfile(v.resourceType)?.massKgPerUnit??1)+
  ((v.passengers??0)+(v.crewQuantity??0))*75;}
