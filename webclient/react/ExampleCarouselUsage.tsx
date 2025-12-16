import React from "react";
import { InfiniteGameCarousel, GameItem } from "./InfiniteGameCarousel";

const items: GameItem[] = [
  {
    id: "updown",
    title: "UP&DOWN",
    subtitle: "업다운",
    icon: "↕️",
    onClick: () => console.log("UP&DOWN 선택"),
  },
  {
    id: "slot",
    title: "SLOT MACHINE",
    subtitle: "슬롯머신",
    icon: "🎰",
    onClick: () => console.log("슬롯머신 선택"),
  },
  {
    id: "baccarat",
    title: "BACCARAT",
    subtitle: "바카라",
    icon: "🂡",
    onClick: () => console.log("바카라 선택"),
  },
  {
    id: "horse",
    title: "HORSE RACING",
    subtitle: "온라인 경마",
    icon: "🏇",
    onClick: () => console.log("경마 선택"),
  },
];

export const ExampleCarouselUsage: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-50">
      <h1 className="mb-4 text-xl font-bold">Games</h1>
      <InfiniteGameCarousel
        items={items}
        speedPxPerSec={72}
        wheelSpeed={0.5}
        resumeDelayMs={200}
      />
    </div>
  );
};
