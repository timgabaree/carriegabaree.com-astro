import {defineConfig} from 'astro/config';
import {fileURLToPath} from 'node:url';
import {readArchive} from './scripts/archive-data.mjs';
import {buildArchiveIndex} from './scripts/archive-index.mjs';
if(process.env.ARCHIVE_PREVIEW==='1'&&process.env.PUBLIC_SITE_ENV==='production')throw new Error('Archive preview cannot be deployed as production.');
export default defineConfig({site:'https://carriegabaree.com',outDir:process.env.PUBLIC_SITE_ENV==='production'?'./dist-production':'./dist',trailingSlash:'never',build:{format:'file',inlineStylesheets:'never'},integrations:[{name:'approved-archive-search',hooks:{'astro:build:done':async({dir})=>{await buildArchiveIndex(readArchive(),fileURLToPath(new URL('archive-index/',dir)));}}}]});
