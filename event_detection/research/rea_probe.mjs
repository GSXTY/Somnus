/** Read-only REA 6.8.0 static evidence, without MCP registration or target launch.
 * Uses the published package's service/provider modules (internal API, pinned).
 * Install REA's dependencies or at least its zod dependency before invoking.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const values = process.argv.slice(2);
const args = {};
for (let i = 0; i < values.length; i += 2) {
  if (!['--rea-root', '--pe', '--directory', '--output'].includes(values[i]) || !values[i + 1] || args[values[i]]) {
    throw new Error('Usage: node rea_probe.mjs --rea-root PACKAGE_DIRECTORY (--pe IMAGE.exe | --directory APP_DIRECTORY) --output NEW.json');
  }
  args[values[i]] = resolve(values[i + 1]);
}
if (Object.keys(args).length !== 3 || !args['--rea-root'] || !args['--output'] || Boolean(args['--pe']) === Boolean(args['--directory'])) throw new Error('Select exactly one PE file or application directory, plus root and output.');
const root = args['--rea-root'];
const metadataBytes = await readFile(join(root, 'package.json'));
const metadata = JSON.parse(metadataBytes);
if (metadata.name !== 'rea-agents' || metadata.version !== '6.8.0') throw new Error('This wrapper pins the internal module API to rea-agents 6.8.0.');
const isPe = Boolean(args['--pe']);
let service;
if (isPe) {
  const { PeImportsProvider } = await import(pathToFileURL(join(root, 'dist/native/pe/PeImportsProvider.js')).href);
  const { PeImportsService } = await import(pathToFileURL(join(root, 'dist/application/binaryDiagnostics/PeImportsService.js')).href);
  service = new PeImportsService(new PeImportsProvider());
} else {
  const { DesktopApplicationReader } = await import(pathToFileURL(join(root, 'dist/artifacts/DesktopApplicationReader.js')).href);
  const { DesktopApplicationService } = await import(pathToFileURL(join(root, 'dist/application/artifacts/DesktopApplicationService.js')).href);
  service = new DesktopApplicationService(new DesktopApplicationReader());
}
let result;
try {
  result = await service.inspect({ path: args['--pe'] ?? args['--directory'] });
} finally {
  await service.close();
}
if (!result.ok) throw new Error(JSON.stringify(result.error, Object.getOwnPropertyNames(result.error)));
const record = {
  rea: { version: metadata.version, package_json_sha256: createHash('sha256').update(metadataBytes).digest('hex'),
    invocation: isPe ? 'Published PeImportsService / PeImportsProvider; no CLI/MCP registration' : 'Published DesktopApplicationService / DesktopApplicationReader; no CLI/MCP registration', target_executed: false },
  evidence: result.value,
  interpretation: 'Static file/directory facts only. An installer is distinct from its runtime. Imports, path markers and source tags do not prove loaded behavior, source/binary equivalence or device firmware event classification logic.'
};
await mkdir(dirname(args['--output']), { recursive: true });
await writeFile(args['--output'], JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({ output: args['--output'], rea_version: metadata.version, target_executed: false }));
