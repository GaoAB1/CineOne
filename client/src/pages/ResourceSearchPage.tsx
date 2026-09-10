/**
 * 资源搜索结果页 /resources?q=片名：
 * 展示后端从 BT 站 1lou 抓取解析后的条目（标题/标签/作者/日期/查看/评论），
 * 支持改词重搜、分页加载更多、原帖外链跳转。
 * 源站搜索较慢（10~30s），首查有明确等待提示。
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { searchResources, type ResourceItem } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import Button from '../components/ui/Button';
import GlassPanel from '../components/ui/GlassPanel';
import Spinner from '../components/ui/Spinner';

const SITE_BASE = 'https://1lou.cc';

function fallbackSearchUrl(keyword: string): string {
  return `${SITE_BASE}/search-${encodeURIComponent(keyword.trim())}.htm`;
}

function metaLine(item: ResourceItem): string {
  const parts: string[] = [];
  if (item.author) parts.push(item.author);
  if (item.date) parts.push(item.date);
  if (item.views != null) parts.push(`${item.views} 次查看`);
  if (item.comments != null) parts.push(`${item.comments} 回复`);
  return parts.join(' · ');
}

export default function ResourceSearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const keyword = (searchParams.get('q') ?? '').trim();

  const [input, setInput] = useState(keyword);
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    setInput(keyword);
  }, [keyword]);

  const runSearch = useCallback(async (kw: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setSearched(false);
    try {
      const res = await searchResources(kw, 1);
      setItems(res.items);
      setPage(res.page);
      setTotalPages(res.totalPages);
      setCached(res.cached);
      setSearched(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '资源检索失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!keyword) {
      setItems([]);
      setSearched(false);
      setError(null);
      return;
    }
    void runSearch(keyword);
  }, [keyword, runSearch]);

  const handleSubmit = (): void => {
    const kw = input.trim();
    if (!kw) return;
    if (kw === keyword) void runSearch(kw);
    else setSearchParams({ q: kw });
  };

  const loadMore = async (): Promise<void> => {
    if (loadingMore || page >= totalPages) return;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await searchResources(keyword, next);
      setItems((prev) => [...prev, ...res.items]);
      setPage(res.page);
      setTotalPages(res.totalPages);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : '加载更多失败');
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="pb-8">
      <div className="mb-5 flex items-center gap-2">
        <Button
          variant="plain"
          className="-ml-3 text-[15px]"
          icon={<i className="ri-arrow-left-line text-[20px]" aria-hidden />}
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
          aria-label="返回上一级"
        >
          返回
        </Button>
      </div>

      <div className="mb-2">
        <h1 className="type-title">资源搜索</h1>
        <p className="type-caption mt-1 text-txt-tertiary">
          聚合 BT 站 1lou 的片源索引 · 点击条目在原站查看详情
        </p>
      </div>

      {/* 搜索框 */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <i
            className="ri-search-line pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[18px]"
            style={{ color: 'var(--text-tertiary)' }}
            aria-hidden
          />
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
            placeholder="搜索影视名称或规格关键词…"
            aria-label="资源搜索关键词"
            className="h-11 w-full rounded-pill border border-line bg-card pl-11 pr-4 text-body text-txt-primary outline-none placeholder:text-txt-tertiary focus:border-accent focus:shadow-[var(--focus-ring)]"
            style={{ borderRadius: 'var(--radius-pill)' }}
          />
        </div>
        <Button variant="filled" onClick={handleSubmit} loading={loading}>
          搜索
        </Button>
      </div>

      {/* 状态区 */}
      {loading && (
        <div className="py-10">
          <Spinner label="正在检索资源站，首次查询约需 10~30 秒" />
        </div>
      )}

      {!loading && error && (
        <GlassPanel className="mx-auto mt-6 max-w-[520px] p-6 text-center" bordered>
          <i className="ri-cloud-off-line text-[32px]" style={{ color: 'var(--color-danger)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">{error}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <Button variant="gray" onClick={() => void runSearch(keyword)}>
              重试
            </Button>
            {keyword && (
              <a
                href={fallbackSearchUrl(keyword)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-4 text-[15px] font-medium"
                style={{ color: 'var(--color-accent)' }}
              >
                在原站打开
                <i className="ri-external-link-line text-[16px]" aria-hidden />
              </a>
            )}
          </div>
        </GlassPanel>
      )}

      {!loading && !error && searched && items.length === 0 && (
        <GlassPanel className="mx-auto mt-6 max-w-[480px] p-8 text-center" bordered>
          <i className="ri-file-search-line text-[34px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">未找到与「{keyword}」相关的资源</p>
          <p className="type-caption mt-1 text-txt-tertiary">可尝试缩短关键词（仅保留片名）后重试</p>
          <a
            href={fallbackSearchUrl(keyword)}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-4 text-[15px] font-medium"
            style={{ color: 'var(--color-accent)' }}
          >
            在原站搜索
            <i className="ri-external-link-line text-[16px]" aria-hidden />
          </a>
        </GlassPanel>
      )}

      {!loading && !keyword && (
        <GlassPanel className="mx-auto mt-10 max-w-[440px] p-8 text-center" bordered>
          <i className="ri-download-cloud-2-line text-[36px]" style={{ color: 'var(--text-tertiary)' }} aria-hidden />
          <p className="type-body mt-3 text-txt-secondary">输入片名开始检索资源</p>
          <p className="type-caption mt-1 text-txt-tertiary">支持电影 / 剧集名称与规格关键词</p>
        </GlassPanel>
      )}

      {/* 结果区 */}
      {!loading && items.length > 0 && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <p className="type-caption text-txt-tertiary">
              「{keyword}」共 {items.length} 条结果
              {totalPages > 1 ? ` · 第 ${page}/${totalPages} 页` : ''}
            </p>
            {cached && (
              <span
                className="rounded-pill px-2 py-[2px] text-[11px]"
                style={{ background: 'var(--color-bg-secondary)', color: 'var(--text-tertiary)' }}
              >
                缓存
              </span>
            )}
          </div>

          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <li key={item.tid}>
                <GlassPanel className="p-4" bordered>
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="line-clamp-2 text-[15px] font-medium text-txt-primary transition-colors duration-fast ease-out hover:text-accent"
                        title={item.title}
                      >
                        {item.title}
                      </a>

                      {item.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {item.tags.slice(0, 6).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-pill px-2 py-[2px] text-[11px]"
                              style={{
                                background: 'var(--surface-warm)',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <p className="type-caption mt-2 text-txt-tertiary">{metaLine(item)}</p>
                    </div>

                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="press-spring flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-sm border border-line px-3 text-[13px] font-medium text-txt-secondary transition-colors duration-fast ease-out hover:text-txt-primary"
                    >
                      原帖
                      <i className="ri-external-link-line text-[14px]" aria-hidden />
                    </a>
                  </div>
                </GlassPanel>
              </li>
            ))}
          </ul>

          {page < totalPages && (
            <div className="mt-6 text-center">
              <Button variant="gray" loading={loadingMore} onClick={() => void loadMore()}>
                加载更多（第 {page + 1}/{totalPages} 页）
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
