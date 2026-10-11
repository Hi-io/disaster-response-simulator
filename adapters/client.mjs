import {createHash} from 'node:crypto';

export class SourceClient {
  constructor({baseUrl='http://127.0.0.1:4319',actorKey,fetcher=fetch}={}) {this.baseUrl=baseUrl.replace(/\/$/,'');this.actorKey=actorKey;this.fetcher=fetcher;}
  async request(path,{method='GET',body}={}) {
    const response=await this.fetcher(this.baseUrl+path,{method,headers:{Authorization:`Bearer ${this.actorKey??''}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok){const error=new Error(result.message??result.error);error.code=result.error;error.status=response.status;throw error;}return result;
  }
  state(){return this.request('/api/actor/state');}
  queries(){return this.request('/api/actor/queries');}
  action(type,params,idempotencyKey,expectedVersion){return this.request('/api/actor/action',{method:'POST',body:{type,params,idempotencyKey,...(expectedVersion===undefined?{}:{expectedVersion})}});}
  async feed({q='',cursor=0,limit=50,since=0}={}){
    const result=await this.request('/api/feed?'+new URLSearchParams({q,cursor,limit,since}));
    for(const post of result.posts)await this.ingest(post,'downloaded');return result;
  }
  ingest(post,stage,reason=null){return this.request('/api/actor/ingestion',{method:'POST',body:{id:post.id,version:post.version,stage,reason,contentHash:createHash('sha256').update(JSON.stringify(post)).digest('hex')}});}
  async scrape({cursor=0}={}) {
    const response=await this.fetcher(`${this.baseUrl}/feed?cursor=${cursor}`,{headers:{Authorization:`Bearer ${this.actorKey??''}`}});if(!response.ok)throw new Error(`Scrape failed: ${response.status}`);
    const html=await response.text();const ids=[...html.matchAll(/data-post-id="([a-f0-9]{24})"/g)].map(match=>match[1]);
    return {ids,nextCursor:Number(html.match(/rel="next" href="\/feed\?cursor=(\d+)"/)?.[1]??NaN),html};
  }
}
