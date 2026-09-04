/**
 * 主页：Hero 精选区（每周热门第 1 项）+ 四大分区卡片流 + 骨架屏加载态。
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchHome, fetchTmdbStatus, fetchTmdbUpcoming } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { HomeSection, MediaItem } from '../api/types';
import MediaRow from '../components/media/MediaRow';
import Hero from '../components/media/Hero';
import GlassPanel from '../components/ui/GlassPanel';
import Button from '../components/ui/Button';

/** 加载骨架：Hero 块 + 分区标题条 + 6 张海报骨架，全部 shimmer */
function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="正在加载首页内容">
      <div className="skeleton-shimmer mb-6" style={{ borderRadius: 'var(--radius-lg)', aspectRatio: '21 / 9' }} />
      {[0, 1].map((row) => (
        <div key={row} className="mb-6">
          <div className="skeleton-shimmer mb-3 h-4 w-[120px]" style={{ borderRadius: 'var(--radius-sm)' }} />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-shimmer w-[128px] shrink-0"
                style={{ borderRadius: 'var(--radius-card)', aspectRatio: '2 / 3' }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [upcoming, setUpcoming] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await fetchTmdbStatus();
        if (cancelled) return;
        if (!status.configured) {
          setConfigured(false);
          return;
        }
        setConfigured(true);
        const data = await fetchHome('week');
        if (cancelled) return;
        setSections(data.sections);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiClientError ? err.message : '内容加载失败，请稍后重试');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 「即将上映」行：静默加载，失败不影响主分区
  useEffect(() => {
    let cancelled = false;
    fetchTmdbUpcoming()
      .then((items) => {
        if (!cancelled && Array.isArray(items)) setUpcoming(items);
      })
      .catch(() => {
        // 静默：即将上映加载失败时跳过该行
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 引导分支：未配置 TMDB Key
  if (configured === false) {
    return (
      <GlassPanel className="mx-auto mt-10 max-w-[560px] p-8 text-center" bordered>
        <i className="ri-key-2-line text-[40px]" style={{ color: 'var(--color-accent)' }} aria-hidden />
        <h2 className="type-title mb-2 mt-4">先配置 TMDB API Key</h2>
        <p className="type-body mb-6 text-txt-secondary">
          CineOne 通过 TMDB 聚合影视数据。前往「设置」粘贴你的 API Key（v3 auth），即可开启首页与搜索。
        </p>
        <Link to="/settings">
          <Button variant="filled">前往设置</Button>
        </Link>
        <p className="type-caption mt-6 text-txt-tertiary">
          还没有 Key？在 themoviedb.org 免费注册后在账户设置 → API 中申请。
        </p>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel className="mx-auto mt-10 max-w-[520px] p-8 text-center" bordered>
        <i className="ri-cloud-off-line text-[36px]" style={{ color: 'var(--color-danger)' }} aria-hidden />
        <h2 className="type-headline mt-3">加载失败</h2>
        <p className="type-caption mt-2 text-txt-secondary">{error}</p>
        <Button
          variant="gray"
          className="mt-5"
          onClick={() => window.location.reload()}
        >
          重试
        </Button>
      </GlassPanel>
    );
  }

  if (loading) return <HomeSkeleton />;

  // Hero 数据源：第一个分区的前 8 个条目，交给海报轨道横向滚动选择
  const heroItems = sections[0]?.items.slice(0, 8) ?? [];

  return (
    <div>
      {heroItems.length > 0 && <Hero items={heroItems} />}
      {upcoming.length > 0 && <MediaRow title="即将上映" items={upcoming} />}
      {sections.map((section) => (
        <MediaRow key={section.key} title={section.title} items={section.items} />
      ))}
    </div>
  );
}
