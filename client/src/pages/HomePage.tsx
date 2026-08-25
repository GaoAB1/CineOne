/**
 * 主页：四大分区横向卡片流 + 未配置 Key 引导页分支。
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchHome, fetchTmdbStatus } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { HomeSection } from '../api/types';
import MediaRow from '../components/media/MediaRow';
import Spinner from '../components/ui/Spinner';
import GlassPanel from '../components/ui/GlassPanel';
import Button from '../components/ui/Button';

export default function HomePage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sections, setSections] = useState<HomeSection[]>([]);
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

  if (loading) {
    return <Spinner label="正在为你准备今日片单" />;
  }

  return (
    <div>
      {sections.map((section) => (
        <MediaRow key={section.key} title={section.title} items={section.items} />
      ))}
    </div>
  );
}
