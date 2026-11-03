"use client";
import { useEffect, useRef, useState } from "react";
import { CALL_SCENES, type TradeKey } from "@/lib/site-content";

// A short looping scene: the phone rings while you're working, the AI receptionist answers, the
// conversation appears line by line, and the booking text pops up in the top-left corner.
// Runs only while on screen; people who ask for reduced motion see the finished scene.

const RING_MS = 2200;
const LINE_MS = 2300;
const HOLD_MS = 4200;
const BARS = [0.45, 0.75, 1, 0.6, 0.9, 0.5, 0.8, 0.4, 0.7, 1, 0.55, 0.85];

export function CallScene({ trade = "mechanics" }: { trade?: TradeKey }) {
  const scene = CALL_SCENES[trade];
  const total = scene.lines.length;
  // step 0 = ringing, 1..total = lines shown, total + 1 = booked text
  const [step, setStep] = useState(0);
  const [onScreen, setOnScreen] = useState(false);
  const [still, setStill] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      setStep(total + 1);
      return;
    }
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return setOnScreen(true);
    const io = new IntersectionObserver((e) => setOnScreen(e.some((x) => x.isIntersecting)), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [total]);

  useEffect(() => {
    if (still || !onScreen) return;
    const wait = step === 0 ? RING_MS : step <= total ? LINE_MS : HOLD_MS;
    const t = setTimeout(() => setStep((s) => (s > total ? 0 : s + 1)), wait);
    return () => clearTimeout(t);
  }, [step, onScreen, still, total]);

  const ringing = step === 0;
  const aiTalking = !ringing && step <= total && scene.lines[step - 1]?.speaker === "AI Dispatcher";
  const booked = step > total;

  return (
    <div ref={box} className="relative" aria-label={`Example: a call to ${scene.business} answered by the AI receptionist`} role="img">
      {booked ? (
        <div key={`toast-${step}`} className="slide-in-left absolute -left-3 -top-5 z-10 w-[min(88%,320px)] rounded-[12px] border-2 border-[#D8B47A] bg-[#EFE6D4] p-3 text-[#1F3B2D] shadow-[0_10px_30px_rgba(23,48,34,0.45)] sm:-left-6">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#A87A33]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            New text · just now
          </div>
          <div className="font-condensed-800 mt-1 text-xl leading-none">✓ {scene.toast.title}</div>
          <div className="mt-1 text-xs font-medium text-[#6B5A43]">{scene.toast.body}</div>
        </div>
      ) : null}

      <div className="rounded-[20px] border-2 border-[#6B5A43] bg-[#173022] p-5 pt-6 sm:p-6">
        <div className="flex items-center justify-between gap-3 border-b border-[#1F3B2D] pb-4">
          <div className="flex items-center gap-3">
            <span className={`flex h-11 w-11 items-center justify-center rounded-full ${ringing ? "bg-[#D8B47A] text-[#1F3B2D]" : "bg-[#1F3B2D] text-[#D8B47A]"}`}>
              <svg className={ringing ? "ring-shake" : ""} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
            </span>
            <div>
              <div className="font-condensed-700 text-lg leading-tight text-[#EFE6D4]">{ringing ? "Incoming call…" : booked ? "Call ended · booked" : "Answered by your AI receptionist"}</div>
              <div className="text-xs text-[#EFE6D4]/75">{scene.business} · {scene.setting}</div>
            </div>
          </div>
          <div className="flex h-8 items-center gap-[3px]" aria-hidden="true">
            {BARS.map((h, i) => (
              <span key={i} className={`w-[3px] rounded-full ${aiTalking ? "wave-bar bg-[#D8B47A]" : "bg-[#6B5A43]"}`} style={{ height: `${Math.round(h * 28)}px`, ["--bar-delay" as string]: `${i * 70}ms`, transform: aiTalking ? undefined : "scaleY(0.3)" }} />
            ))}
          </div>
        </div>
        <ol className="mt-4 min-h-[232px] space-y-2.5">
          {scene.lines.slice(0, Math.min(step, total)).map((l, i) => {
            const ai = l.speaker === "AI Dispatcher";
            return (
              <li key={`${i}-${step > total ? "done" : "live"}`} className={`pop-in max-w-[88%] rounded-[12px] px-3.5 py-2.5 text-sm leading-snug ${ai ? "ml-auto bg-[#1F3B2D] text-[#EFE6D4]" : "bg-[#EFE6D4] text-[#1F3B2D]"}`}>
                <div className={`mb-0.5 text-[10px] font-bold uppercase tracking-wider ${ai ? "text-[#D8B47A]" : "text-[#6B5A43]"}`}>{ai ? "AI receptionist" : "Caller"}</div>
                {l.text}
              </li>
            );
          })}
          {ringing ? <li className="pt-10 text-center text-sm text-[#EFE6D4]/70">Ring… ring… you&apos;re busy. We&apos;ve got it.</li> : null}
        </ol>
      </div>
    </div>
  );
}
