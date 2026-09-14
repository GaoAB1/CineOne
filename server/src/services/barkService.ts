/**
 * Bark 推送客户端（iOS Bark App；零依赖，Node 内置 fetch）。
 *
 * Bark 接口：POST {server}/push  body: { device_key, title, body, group, ... }
 * 服务器基址可在设置页改（自建 Bark Server），默认 https://api.day.app。
 */

import { getSetting } from './settingsService';

const REQUEST_TIMEOUT_MS = 10_000;
/** 推送分组：Bark App 内按 group 归类展示 */
const GROUP = 'CineOne';

function serverBase(): string {
  const raw = getSetting('bark_server_url').trim() || 'https://api.day.app';
  return raw.replace(/\/+$/, '');
}

export interface BarkSendResult {
  ok: boolean;
  message: string;
}

/** 发送一条 Bark 推送；未配置时静默跳过（返回 ok:false 且不抛错） */
export async function sendBark(title: string, body: string): Promise<BarkSendResult> {
  const deviceKey = getSetting('bark_device_key').trim();
  if (!deviceKey) return { ok: false, message: 'Bark 未配置，跳过推送' };

  try {
    const res = await fetch(`${serverBase()}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ device_key: deviceKey, title, body, group: GROUP }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, message: `Bark 推送失败（HTTP ${res.status}）` };
    }
    const json = (await res.json().catch(() => null)) as { code?: number; message?: string } | null;
    // Bark 成功返回 { code: 0, message: 'success' }
    if (json && typeof json.code === 'number' && json.code !== 0) {
      return { ok: false, message: `Bark 推送被拒绝：${json.message ?? json.code}` };
    }
    return { ok: true, message: '推送成功' };
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? '请求超时' : '网络错误';
    return { ok: false, message: `Bark 推送失败（${reason}）` };
  }
}

/** 设置页「发送测试推送」 */
export async function testBark(): Promise<BarkSendResult> {
  return sendBark('CineOne 测试推送', '如果你收到这条消息，说明 Bark 推送配置成功 ✅');
}
