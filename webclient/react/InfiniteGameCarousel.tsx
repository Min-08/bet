import React, { useEffect, useMemo, useRef } from "react";

export type GameItem = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  buttonLabel?: string;
  onClick?: () => void;
};

export type InfiniteGameCarouselProps = {
  items: GameItem[];
  speedPxPerSec?: number;
  wheelSpeed?: number;
  resumeDelayMs?: number;
  ariaLabel?: string;
  className?: string;
};

export const InfiniteGameCarousel: React.FC<InfiniteGameCarouselProps> = ({
  items,
  speedPxPerSec = 64,
  wheelSpeed = 0.45,
  resumeDelayMs = 220,
  ariaLabel = "게임 카드 슬라이더",
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0); // 누적 이동량(px)
  const baseWidthRef = useRef(0); // 원본 아이템 세트의 전체 길이
  const pausedRef = useRef(false);
  const resumeTimerRef = useRef<number | null>(null);
  const speedRef = useRef(speedPxPerSec);

  useEffect(() => {
    speedRef.current = speedPxPerSec;
  }, [speedPxPerSec]);

  const doubledItems = useMemo(() => [...items, ...items], [items]);

  const wrapOffset = (value: number, width: number) => {
    if (!width) return value;
    const mod = value % width;
    return mod <= 0 ? mod : mod - width; // 항상 [-width, 0) 범위로 유지해 점프 없이 이어 보이도록 함
  };

  const applyOffset = (delta: number) => {
    const track = trackRef.current;
    const width = baseWidthRef.current;
    if (!track || !width) return;

    offsetRef.current = wrapOffset(offsetRef.current + delta, width);
    track.style.transform = `translateX(${offsetRef.current}px)`;
  };

  const measure = () => {
    const track = trackRef.current;
    if (!track) return;
    const singleWidth = track.scrollWidth / 2; // 두 번 이어붙였으므로 절반이 원본 길이
    baseWidthRef.current = singleWidth;
    applyOffset(0); // 길이가 바뀌어도 현재 위치를 감싸 깜빡임 방지
  };

  const pause = () => {
    pausedRef.current = true;
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  };

  const resumeLater = () => {
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      pausedRef.current = false;
      resumeTimerRef.current = null;
    }, resumeDelayMs);
  };

  useEffect(() => {
    measure();
    const handleResize = () => measure();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [items, doubledItems.length]);

  useEffect(() => {
    let frameId: number;
    let last: number | null = null;

    const step = (ts: number) => {
      if (last !== null && !pausedRef.current) {
        const dt = ts - last;
        const distance = (speedRef.current * dt) / 1000;
        applyOffset(-distance);
      }
      last = ts;
      frameId = requestAnimationFrame(step);
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault(); // 슬라이더 위에서는 세로 스크롤 차단
      pause();
      applyOffset(-e.deltaY * wheelSpeed); // deltaY+ => 왼쪽으로 더 이동
      resumeLater();
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [wheelSpeed]);

  if (!items.length) return null;

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-4 ${className}`}
      aria-label={ariaLabel}
      onMouseEnter={pause}
      onMouseLeave={resumeLater}
    >
      <div
        ref={trackRef}
        className="flex gap-4 will-change-transform"
        style={{ transform: "translateX(0px)" }}
      >
        {doubledItems.map((item, idx) => (
          <div
            key={`${item.id}-${idx}`}
            tabIndex={0}
            onClick={item.onClick}
            onKeyDown={(e) => {
              if (item.onClick && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                item.onClick();
              }
            }}
            className="w-64 flex-shrink-0 cursor-pointer outline-none focus:ring-2 focus:ring-blue-500"
          >
            <div className="flex h-36 flex-col rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-extrabold uppercase tracking-tight">
                    {item.title}
                  </p>
                  {item.subtitle && (
                    <p className="text-sm font-semibold text-slate-700">
                      {item.subtitle}
                    </p>
                  )}
                </div>
                <div className="text-4xl leading-none">{item.icon ?? "🎮"}</div>
              </div>
              <div className="mt-auto">
                <button
                  type="button"
                  className="w-full rounded border border-blue-600 px-4 py-1 text-sm font-semibold text-blue-700 transition hover:bg-blue-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    item.onClick?.();
                  }}
                >
                  {item.buttonLabel ?? "선택"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
