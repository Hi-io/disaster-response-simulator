import {validateConfig,manifest} from './contracts/config.mjs';
import {World} from './engine/world.mjs';
import {evaluate} from './evaluation/metrics.mjs';
import {runWorld,saveRun,readJSON,replay,pairedComparison} from './evaluation/runs.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const [command='help',...args]=process.argv.slice(2),opts={};
for(let i=0;i<args.length;i++){if(!args[i].startsWith('--'))throw new Error('Use named flags');const name=args[i].slice(2);opts[name]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;}
const loadConfig=async()=>{const c=opts.config?await readJSON(opts.config):{};for(const key of ['seed','scenario','policy','hazard','variant','split'])if(opts[key])c[key]=opts[key];for(const key of ['grid','extentKm','durationMs','postsPerHour','backgroundTraffic','maxEvents','maxPosts'])if(opts[key])c[key]=Number(opts[key]);return validateConfig(c);};
const out=data=>console.log(JSON.stringify(data,null,2));
const output=opts.output??'runs';
try{
  if(command==='help')console.log(`Disaster Response Simulator\n\nnode cli.mjs validate --config manifests/city.json\nnode cli.mjs generate --config manifests/region.json --output runs/map.json\nnode cli.mjs run --scenario S01 --policy rules --seed example --output runs/example\nnode cli.mjs batch --config manifests/city.json --seeds 1,2,3 --policies conventional,rules,federated --output runs/batch\nnode cli.mjs replay --checkpoint runs/example/checkpoint.json.gz\nnode cli.mjs fork --checkpoint runs/example/checkpoint.json.gz --inputs path/to/actions.json --output runs/fork\nnode cli.mjs compare --a path/to/a.json --b path/to/b.json\nnode cli.mjs export --checkpoint runs/example/checkpoint.json.gz --output runs/export\n\nAll quantities and elapsed times are simulated; no field validity is implied.`);
  else if(command==='validate')out({valid:true,manifest:manifest(await loadConfig())});
  else if(command==='generate'){const w=new World(await loadConfig());await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(w.state.map,null,2));out({file:output,runId:w.runId,mapHash:w.state.map.hash});}
  else if(command==='run'){const config=await loadConfig(),inputs=opts.inputs?await readJSON(opts.inputs):[];out(await saveRun(runWorld(config,inputs),output));}
  else if(command==='batch'){
    const config=await loadConfig(),rows=[],seeds=String(opts.seeds??'1,2,3').split(','),policies=String(opts.policies??'conventional,rules,investigation,federated').split(',');
    for(const seed of seeds)for(const policy of policies){const result=runWorld({...config,seed,policy,mode:'headless'});const directory=path.join(output,`${seed.replace(/[^a-zA-Z0-9_-]/g,'_')}-${policy}`);await saveRun(result,directory);const row={seed,scenario:config.scenario,variant:config.variant,policy,hash:result.hash,wallMs:result.wallMs,metrics:result.metrics};rows.push(row);console.error(`${rows.length}/${seeds.length*policies.length} ${seed} ${policy}: ${result.world.eventCount} events`);}
    await writeFile(path.join(output,'batch.json'),JSON.stringify(rows,null,2));out({file:path.join(output,'batch.json'),episodes:rows.length});
  }else if(command==='replay'){const result=replay(await readJSON(opts.checkpoint));out({matches:result.matches,expected:result.expected,actual:result.actual,runId:result.world.runId});if(!result.matches)process.exitCode=1;}
  else if(command==='fork'){const cp=await readJSON(opts.checkpoint);out(await saveRun(runWorld(cp.manifest.config,opts.inputs?await readJSON(opts.inputs):[],cp),output));}
  else if(command==='compare'){out(pairedComparison(await readJSON(opts.a),await readJSON(opts.b)));}
  else if(command==='export'){const cp=await readJSON(opts.checkpoint),w=new World(cp.manifest.config,cp);await mkdir(output,{recursive:true});await writeFile(path.join(output,'metrics.json'),JSON.stringify(evaluate(w),null,2));const csv=['need,building,type,unit,demand,served,deadline_ms,completed_ms',...w.state.needs.map(n=>[n.id,n.building,n.type,n.unit,n.quantity,n.served,n.deadline,n.completedAt??''].join(','))].join('\n');await writeFile(path.join(output,'communities.csv'),csv);out({directory:output,runId:w.runId,rows:w.state.needs.length});}
  else throw new Error(`Unknown command: ${command}`);
}catch(error){console.error(error.message);process.exitCode=1;}
