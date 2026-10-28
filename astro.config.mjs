import {defineConfig} from 'astro/config';
export default defineConfig({site:'https://carriegabaree.com',outDir:process.env.PUBLIC_SITE_ENV==='production'?'./dist-production':'./dist',trailingSlash:'never',build:{format:'file',inlineStylesheets:'never'}});
