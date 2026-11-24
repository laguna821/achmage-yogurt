import {expect,it} from 'vitest'
import {searchPublic,readPublicSource} from '../src/main/video/research'
it.skipIf(process.env.YOGURT_NETWORK_PROBE!=='1')('reads a real public search result without any AI call',async()=>{
 const stop=AbortSignal.timeout(60000),urls=await searchPublic('causal models site:plato.stanford.edu',stop)
 console.log('PUBLIC_SEARCH='+JSON.stringify({count:urls.length,hosts:urls.slice(0,3).map(u=>new URL(u).hostname)}));expect(urls.length).toBeGreaterThan(0)
 let source;for(const url of urls.slice(0,5)){try{source=await readPublicSource(url,'R1',stop);break}catch{}}
 if(!source)throw new Error('검색된 원문 5건에 접근하지 못했습니다.');expect(source.text.length).toBeGreaterThan(200);console.log('PUBLIC_RECEIPT='+JSON.stringify({title:source.title,chars:source.text.length,sha256:source.sha256}))
},75000)
