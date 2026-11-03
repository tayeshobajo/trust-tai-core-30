/** Read-only local build check. Never installs packages, connects accounts or deploys. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import ts from 'typescript';
const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const npmLock = JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
const bunLock = ts.parseConfigFileTextToJson('bun.lock',readFileSync(join(root,'bun.lock'),'utf8'));
if (bunLock.error) throw new Error('Bun lockfile could not be parsed');
const npmDifferences=[]; const errors=[];
for (const group of ['dependencies','devDependencies']) {
 for (const [name,spec] of Object.entries(manifest[group] ?? {})) {
  if (npmLock.packages[''][group]?.[name]!==spec) npmDifferences.push({name,manifest:spec,npmRoot:npmLock.packages[''][group]?.[name] ?? null});
  if (bunLock.config.workspaces[''][group]?.[name]!==spec) errors.push(`Bun manifest mismatch: ${name}`);
  if (/^\d/.test(spec)) {
   let installed;
   try {installed=JSON.parse(readFileSync(join(root,'node_modules',name,'package.json'),'utf8')).version;} catch {errors.push(`Missing installed dependency: ${name}`);continue;}
   if (installed!==spec) errors.push(`Installed ${name}@${installed} does not match declared ${spec}`);
  }
 }
}
let revision=null;try {revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{}
const result={revision,node:process.version,bunLockSha256:createHash('sha256').update(readFileSync('bun.lock')).digest('hex'),npmManifestDifferences:npmDifferences,errors,
 requiredBuildPath:'Use a clean bun install --frozen-lockfile before build; do not use the stale npm lock or existing node_modules as reproducibility proof.'};
console.log(JSON.stringify(result,null,2));
if(errors.length)process.exitCode=1;
