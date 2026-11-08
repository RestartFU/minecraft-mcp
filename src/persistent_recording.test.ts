import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const recorder = new URL("./recorder.ts", import.meta.url).pathname;
const persistent = new URL("./persistent_recording.ts", import.meta.url).pathname;

/** Runs one recorder owner or adopter with an isolated cache and fake capture tools. */
async function run(root: string, script: string) {
  const proc = Bun.spawn([process.execPath, "-e", `${script};process.exit(0);`], {
    env: { ...process.env, XDG_CACHE_HOME: root, PATH: `${root}/bin:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`${err}\n${out}`);
  return JSON.parse(out);
}

/** Provides a capture that produces bytes until gracefully interrupted or sent q. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "minecraft-recording-"));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin", "python3"), `#!${process.execPath}\nconsole.log(JSON.stringify({display:':99',xauthority:'/unused',window:1}));\n`, { mode: 0o700 });
  await writeFile(join(root, "bin", "ffmpeg"), `#!${process.execPath}
import {appendFileSync} from 'node:fs';
if(process.argv.includes('lavfi'))process.exit(0);
if(process.env.FAIL_CAPTURE)process.exit(2);
const path=process.argv.at(-1);
const timer=setInterval(()=>appendFileSync(path,'frame\\n'),50);
const stop=()=>{clearInterval(timer);appendFileSync(path,'finished\\n');process.exit(0)};
process.on('SIGINT',stop);
process.stdin.on('data',data=>{if(data.includes('q'))stop()});
`, { mode: 0o700 });
  return root;
}

test("persistent capture survives connection cleanup and owner exit, then another owner finishes it", async () => {
  const root = await fixture();
  const output = join(root, "proof.mkv");
  try {
    await run(root, `import {startRecording,stopAllRecordings} from ${JSON.stringify(recorder)};
      await startRecording('owned',${JSON.stringify(output)},60,true);
      await stopAllRecordings();console.log('{}');process.exit(0);`);
    const before = (await readFile(output)).length;
    await Bun.sleep(250);
    expect((await readFile(output)).length).toBeGreaterThan(before);
    const result = await run(root, `import {recordingStatus,stopRecording} from ${JSON.stringify(recorder)};
      const status=await recordingStatus('owned');const stopped=await stopRecording('owned');
      console.log(JSON.stringify({status,stopped,after:await recordingStatus('owned')}));`);
    expect(result.status.recording).toBe(true);
    expect(result.status.persistent).toBe(true);
    expect(result.stopped.bytes).toBeGreaterThan(before);
    expect(result.after.recording).toBe(false);
    expect((await readFile(output, "utf8")).endsWith("finished\n")).toBe(true);
  } finally {
    // Clean up a failed assertion without leaving a detached test producer.
    await run(root, `import {stopRecording} from ${JSON.stringify(recorder)};try{await stopRecording('owned')}catch{}console.log('{}');`);
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

test("ordinary recordings still stop with their connection", async () => {
  const root = await fixture();
  const output = join(root, "ordinary.mkv");
  try {
    const result = await run(root, `import {startRecording,stopAllRecordings,recordingStatus} from ${JSON.stringify(recorder)};
      await startRecording('owned',${JSON.stringify(output)},60);await stopAllRecordings();console.log(JSON.stringify(await recordingStatus('owned')));`);
    expect(result.recording).toBe(false);
    expect((await readFile(output, "utf8")).endsWith("finished\n")).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 10_000);

test("persistent stop refuses a reused PID and leaves that process alive", async () => {
  const root = await fixture();
  try {
    const result = await run(root, `import {mkdir,writeFile} from 'node:fs/promises';
      import {stopPersistentRecording} from ${JSON.stringify(persistent)};
      const dir=${JSON.stringify(join(root, "minecraft-mcp", "recordings"))};await mkdir(dir,{recursive:true});
      await writeFile(dir+'/owned.json',JSON.stringify({pid:process.pid,identity:'wrong-start-time',path:'/unused',errors:'/unused',started:0,encoder:'fake'}));
      try{await stopPersistentRecording('owned');throw Error('unexpected stop')}catch(error){console.log(JSON.stringify({error:String(error),alive:true}))}`);
    expect(result.error).toContain("refusing to signal a reused PID");
    expect(result.alive).toBe(true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("persistent start failure removes its reservation so a corrected start can succeed", async () => {
  const root = await fixture();
  try {
    const result = await run(root, `import {startRecording,stopRecording} from ${JSON.stringify(recorder)};
      process.env.FAIL_CAPTURE='1';let error='';try{await startRecording('owned',${JSON.stringify(join(root, "failed.mkv"))},60,true)}catch(e){error=String(e)};
      delete process.env.FAIL_CAPTURE;await startRecording('owned',${JSON.stringify(join(root, "corrected.mkv"))},60,true);
      let duplicate='';try{await startRecording('owned',${JSON.stringify(join(root, "duplicate.mkv"))},60,true)}catch(e){duplicate=String(e)};
      await stopRecording('owned');console.log(JSON.stringify({error,duplicate}));`);
    expect(result.error).toContain("recording failed to start");
    expect(result.duplicate).toContain("already recording");
  } finally {
    await run(root, `import {stopRecording} from ${JSON.stringify(recorder)};try{await stopRecording('owned')}catch{}console.log('{}');`);
    await rm(root, { recursive: true, force: true });
  }
}, 12_000);
