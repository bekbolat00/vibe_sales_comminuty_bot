/**
 * Стек: React 18, TypeScript, Tailwind CSS (сборка через Vite для встраивания в index.html)
 */

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";

interface LessonPlayerProps {
  videoId: string;
  userId: string;
}

type DebouncedWithFlush = ((time: number) => void) & { flush: () => void };

function createDebounceWithFlush(
  fn: (time: number) => void,
  ms: number
): DebouncedWithFlush {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = 0;

  const debounced = ((time: number) => {
    latest = time;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(latest);
    }, ms);
  }) as DebouncedWithFlush;

  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    fn(latest);
  };

  return debounced;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        el: HTMLElement | string,
        config: {
          videoId: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, string | number | undefined>;
          events?: {
            onReady?: (e: { target: YTPlayerInstance }) => void;
            onStateChange?: (e: { data: number; target: YTPlayerInstance }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  destroy: () => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
}

const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";

function loadYouTubeIframeAPI(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve();

    if (window.YT?.Player) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${IFRAME_API_SRC}"]`
    );
    if (existing) {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve();
      };
      return;
    }

    const tag = document.createElement("script");
    tag.src = IFRAME_API_SRC;
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    document.head.appendChild(tag);
  });
}

export function LessonPlayer({ videoId, userId }: LessonPlayerProps) {
  const [scriptReady, setScriptReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const persistRef = useRef<(stoppedAt: number) => void>(() => {});
  persistRef.current = async (stoppedAt: number) => {
    await supabase.from("video_progress").upsert(
      {
        user_id: userId,
        video_id: videoId,
        stopped_at: stoppedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,video_id" }
    );
  };

  const debouncedSaveRef = useRef<DebouncedWithFlush | null>(null);
  if (!debouncedSaveRef.current) {
    debouncedSaveRef.current = createDebounceWithFlush(
      (t: number) => {
        void persistRef.current(t);
      },
      5000
    );
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadYouTubeIframeAPI();
      if (!cancelled) setScriptReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!scriptReady || !containerRef.current || !window.YT?.Player) return;

    let destroyed = false;

    const debounced = debouncedSaveRef.current!;

    void (async () => {
      const { data } = await supabase
        .from("video_progress")
        .select("stopped_at")
        .eq("user_id", userId)
        .eq("video_id", videoId)
        .maybeSingle();

      if (destroyed || !containerRef.current) return;

      const raw = data?.stopped_at;
      const savedSeconds =
        raw !== null && raw !== undefined ? Math.floor(Number(raw)) : 0;

      const playerVars: Record<string, string | number | undefined> = {
        playsinline: 1, // КРИТИЧНО: чтобы Telegram/iOS не блокировал плеер
        fs: 1, // Включает нативную кнопку полного экрана
        rel: 0, // Убирает рекомендации чужих видео в конце
        modestbranding: 1, // Убирает логотип YouTube
      };
      if (savedSeconds > 0) {
        playerVars.start = savedSeconds;
      }

      const YT = window.YT!;
      const PLAYING = YT.PlayerState?.PLAYING ?? 1;

      const player = new YT.Player(containerRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars,
        events: {
          onReady: () => {},
          onStateChange: (e) => {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }

            if (e.data === PLAYING) {
              pollRef.current = setInterval(() => {
                try {
                  debounced(player.getCurrentTime());
                } catch {
                  /* player tearing down */
                }
              }, 1000);
            } else {
              debounced.flush();
            }
          },
        },
      });
      playerRef.current = player;
    })();

    return () => {
      destroyed = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      debounced.flush();
      try {
        playerRef.current?.destroy();
      } catch {
        /* ignore */
      }
      playerRef.current = null;
    };
  }, [scriptReady, videoId, userId]);

  return (
    <div className="w-full overflow-hidden rounded-xl">
      {!scriptReady ? (
        <div className="flex aspect-video w-full animate-pulse items-center justify-center rounded-xl border border-orange-500/20 bg-[#1a1a1a] text-sm text-orange-500">
          Загрузка плеера...
        </div>
      ) : (
        <div ref={containerRef} className="aspect-video w-full" />
      )}
    </div>
  );
}
