import fs from 'node:fs';
import path from 'node:path';

const [pluginName, sourceDirectory, outputDirectory] = process.argv.slice(2);

if (!pluginName || !sourceDirectory || !outputDirectory) {
  throw new Error('Usage: node stage-plugin-compat-fixture.mjs <plugin-name> <source-dir> <output-dir>');
}

const resolvedSource = path.resolve(sourceDirectory);
const distDirectory = path.join(resolvedSource, 'dist');
const distZipFiles = fs.existsSync(distDirectory)
  ? fs
      .readdirSync(distDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.zip'))
      .map((entry) => path.join(distDirectory, entry.name))
  : [];
const rootZipFiles = fs
  .readdirSync(resolvedSource, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.zip'))
  .map((entry) => path.join(resolvedSource, entry.name));
const zipFiles = distZipFiles.length > 0 ? distZipFiles : rootZipFiles;
if (zipFiles.length !== 1) {
  throw new Error(
    `Expected exactly one plugin ZIP in ${resolvedSource} or its dist directory; found ${zipFiles.length}`,
  );
}

const destination = path.resolve(outputDirectory);
fs.mkdirSync(destination, { recursive: true });
const stagedPath = path.join(destination, `${pluginName}.zip`);
fs.copyFileSync(zipFiles[0], stagedPath);
console.log(`Staged ${pluginName}: ${zipFiles[0]} -> ${stagedPath}`);
