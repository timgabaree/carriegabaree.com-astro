import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('family footer lists only the five public HTTPS homepages',()=>{
 const sites=JSON.parse(readFileSync(new URL('../src/data/family-sites.json',import.meta.url),'utf8'));
 assert.deepEqual(sites.map(s=>new URL(s.url).hostname),['carriegabaree.com','clintgabaree.com','finngabaree.com','rgesol.com','timgabaree.com']);
 for(const site of sites){const url=new URL(site.url);assert.equal(site.label,url.hostname);assert.equal(url.protocol,'https:');assert.equal(url.pathname,'/');assert.equal(url.search+url.hash+url.username+url.password,'');}
 const component=readFileSync(new URL('../src/components/FamilySites.astro',import.meta.url),'utf8');
 assert.match(component,/target="_blank" rel="noopener noreferrer"/);
 assert.match(component,/opens in a new tab/);
 const footer=readFileSync(new URL('../src/components/Footer.astro',import.meta.url),'utf8');
 assert.match(footer,/<FamilySites \/><\/div><\/footer>/);
});
