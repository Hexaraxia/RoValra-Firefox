import path from 'node:path';
import { root, readJson, writeJson, validateRepository, updateUrl } from './common.mjs';

const repository = validateRepository(process.argv[2]?.replace(/^https:\/\/github.com\//, '').replace(/\.git$/, '').replace(/\/$/, ''));
const file = path.join(root, 'firefox.config.json');
const config = await readJson(file);
config.repository = repository;
await writeJson(file, config);
console.log(`Configured ${repository}\nUpdate feed: ${updateUrl(repository)}\nKeep the add-on ID and repository stable after the first signed install.`);
