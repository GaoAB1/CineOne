/**
 * 网络代理支持（undici ProxyAgent，按 URL 缓存实例）：
 *  - TMDB 恒走代理（proxy_url 非空时）
 *  - 资源站（hgeme）按设置 proxy_resource_sites 可选走代理
 *  - 其他服务（115 / qB / MoviePilot / Emby / Bark / 豆瓣聚合）一律不走代理
 *
 * 使用方式：fetch 调用处用 proxyDispatcherFor(...) 取 dispatcher，
 * 以 `...(dispatcher ? { dispatcher } : {})` 注入（原生 fetch 基于 undici，支持该选项）。
 */

import { ProxyAgent } from 'undici';
import { getSetting } from './settingsService';

let cached: { url: string; agent: ProxyAgent } | null = null;

function agentFor(url: string): ProxyAgent | undefined {
  if (cached && cached.url === url) return cached.agent;
  try {
    const agent = new ProxyAgent(url);
    cached = { url, agent };
    return agent;
  } catch {
    cached = null;
    return undefined;
  }
}

/** 服务类别：tmdb=恒走代理；resource=按开关；其余类别不调用本函数（不走代理） */
export type ProxyScope = 'tmdb' | 'resource';

/**
 * 取该服务类别应使用的 dispatcher；不走代理返回 undefined（fetch 直连）。
 * 代理地址非法或设置不可读（如测试环境未初始化 DB）时静默降级为直连。
 */
export function proxyDispatcherFor(scope: ProxyScope): ProxyAgent | undefined {
  let url = '';
  try {
    url = getSetting('proxy_url').trim();
    if (scope === 'resource' && getSetting('proxy_resource_sites') !== '1') return undefined;
  } catch {
    return undefined;
  }
  if (!url) return undefined;
  return agentFor(url);
}
