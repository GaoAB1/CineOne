/**
 * 内置播放器页：HLS（master.m3u8）播放 Emby 媒体，剧集自动取第一集。
 * Safari 原生 HLS，其余走 hls.js；播放开始/心跳/停止上报进度（失败静默）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchEmbyPlayInfo, reportEmbyPlayback } from '../api/endpoints';
import { ApiClientError } from '../api/http';
import type { EmbyPlayInfo } from '../api/types';
import Spinner from '../components/ui/Spinner';
import Button from '../components/ui/Button';

/** 播放心跳间隔（毫秒） */
const PROGRESS_INTERVAL_MS = 15_000;
/** Emby tick：100ns，1 秒 = 10_000_000 ticks */
const TICKS_PER_SECOND = 10_000_000;

export default function PlayerPage() {
  const { itemId = '' } = useParams<{ itemId: string }>();
  const navigate = useNavigate();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  const playSessionRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  const [info, setInfo] = useState<EmbyPlayInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const report = useCallback(
    async (event: 'start' | 'progress' | 'stop', positionSeconds: number, paused: boolean) => {
      if (!itemId) return;
      try {
        await reportEmbyPlayback(itemId, {
          event,
          position_ticks: Math.max(0, Math.floor(positionSeconds * TICKS_PER_SECOND)),
          paused,
          play_session_id: playSessionRef.current ?? undefined,
        });
      } catch {
        // 进度上报失败静默（服务端亦不抛错）
      }
    },
    [itemId],
  );

  // 加载播放信息
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchEmbyPlayInfo(itemId)
      .then((res) => {
        if (cancelled) return;
        setInfo(res);
        playSessionRef.current = res.playSessionId;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiClientError ? err.message : '播放信息加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // 接入播放源：原生 HLS（Safari/iOS）优先，否则 hls.js
  useEffect(() => {
    if (!info) return;
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;

    const nativeHls =
      video.canPlayType('application/vnd.apple.mpegurl') !== '' ||
      video.canPlayType('application/x-mpegURL') !== '';

    if (nativeHls) {
      video.src = info.hlsUrl;
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    let cancelledImport = false;
    void import('hls.js')
      .then((mod) => {
        if (cancelledImport || disposed) return;
        const Hls = mod.default;
        if (!Hls.isSupported()) {
          video.src = info.hlsUrl; // 兜底直连
          return;
        }
        const hls = new Hls({ enableWorker: true });
        hls.loadSource(info.hlsUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;
      })
      .catch(() => {
        if (!cancelledImport && !disposed) video.src = info.hlsUrl;
      });

    return () => {
      disposed = true;
      cancelledImport = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute('src');
      video.load();
    };
  }, [info]);

  // 首次起播上报 start
  const handlePlaying = (): void => {
    const video = videoRef.current;
    if (!video) return;
    if (!startedRef.current) {
      startedRef.current = true;
      void report('start', video.currentTime, false);
    }
  };

  // 心跳 + 离开上报 stop
  useEffect(() => {
    if (!info) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.currentTime <= 0) return;
      void report('progress', video.currentTime, false);
    }, PROGRESS_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      const video = videoRef.current;
      if (video && startedRef.current && video.currentTime > 0) {
        // 组件卸载前的最终进度上报（尽力而为）
        void report('stop', video.currentTime, true);
        startedRef.current = false;
      }
    };
  }, [info, report]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* 顶栏 */}
      <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: 'rgba(0,0,0,0.6)' }}>
        <button
          type="button"
          aria-label="返回"
          onClick={() => navigate(-1)}
          className="press-spring flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors duration-fast ease-out hover:bg-white/10 hover:text-white"
        >
          <i className="ri-arrow-left-line text-[22px]" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{info?.title ?? '加载中…'}</p>
          <p className="text-[11px] text-white/50">Emby 媒体库 · CineOne 播放器</p>
        </div>
      </div>

      {/* 视频区 */}
      <div className="relative flex flex-1 items-center justify-center">
        {loading && <Spinner label="正在获取播放地址" />}

        {!loading && error && (
          <div className="max-w-[420px] p-6 text-center">
            <i className="ri-error-warning-line text-[40px] text-white/70" aria-hidden />
            <p className="mt-3 text-[16px] text-white">{error}</p>
            <p className="mt-1 text-[13px] text-white/60">
              请确认该媒体存在于 Emby，且服务器支持转码（HLS）。
            </p>
            <Button variant="gray" className="mt-5" onClick={() => navigate(-1)}>
              返回
            </Button>
          </div>
        )}

        {!loading && !error && info && (
          <video
            ref={videoRef}
            controls
            playsInline
            autoPlay
            className="h-full w-full object-contain"
            onPlaying={handlePlaying}
          />
        )}
      </div>
    </div>
  );
}
