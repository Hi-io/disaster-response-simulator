import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createIsolatedRuntime} from '../sources/isolated-runtime.mjs';
import {World} from '../engine/world.mjs';

test('owner-side persistence writes the complete exact checkpoint but returns only a scoped receipt',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'aidscaler-checkpoint-'));
 const file=path.join(dir,'checkpoint.json'),other=path.join(dir,'other.json');
 const previousArchiveRoot=process.env.AIDSCALER_ARCHIVE_DIR;
 process.env.AIDSCALER_ARCHIVE_DIR=path.join(dir,'archives');
 const runtime=await createIsolatedRuntime({config:{seed:'checkpoint-receipt',grid:5,policy:'none',scenario:'S23'},
   storageDir:path.join(dir,'transport'),checkpointFile:file});
 t.after(async()=>{await runtime.close();if(previousArchiveRoot===undefined)delete process.env.AIDSCALER_ARCHIVE_DIR;
   else process.env.AIDSCALER_ARCHIVE_DIR=previousArchiveRoot;await rm(dir,{recursive:true,force:true});});
 await runtime.request('advance',60000);
 const expected=await runtime.request('checkpoint');
 const receipt=await runtime.persistCheckpoint(),saved=JSON.parse(await readFile(file,'utf8'));
 const normalized=value=>{const copy=structuredClone(value);for(const archive of [copy.log,copy.state.posts,copy.state.messages])
   if(archive?.archive)delete archive.file;return copy;};
 assert.deepEqual(normalized(saved),normalized(expected));
 assert.deepEqual(receipt.log,saved.log);
 assert.equal(receipt.now,saved.now);assert.equal(receipt.runId,saved.runId);
 assert.equal(receipt.state.map,undefined);assert.equal(receipt.state.resources,undefined);
 assert.equal(receipt.queue,undefined);assert.equal(receipt.inputs,undefined);
 assert(JSON.stringify(receipt).length<JSON.stringify(saved).length/2);
 const a=new World(saved.manifest.config,saved),b=new World(expected.manifest.config,expected);
 try{assert.equal(a.stateHash(),b.stateHash());a.advance(120000);b.advance(120000);assert.equal(a.stateHash(),b.stateHash());}
 finally{a.close();b.close();}
 // The destination is private configuration, never a caller-selected path.
 await runtime.request('persistCheckpoint',other);
 await assert.rejects(readFile(other),{code:'ENOENT'});
});

test('unconfigured runtimes cannot write a checkpoint through the new command',async t=>{
 const runtime=await createIsolatedRuntime({config:{grid:4,scenario:'S23',policy:'none'}});
 t.after(()=>runtime.close());
 await assert.rejects(runtime.persistCheckpoint(),/No private checkpoint file/);
 await assert.rejects(runtime.request('persistCheckpoint'),{code:'CHECKPOINT_PATH'});
});
