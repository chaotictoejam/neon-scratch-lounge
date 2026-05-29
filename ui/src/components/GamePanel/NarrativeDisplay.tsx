import { useRef, useEffect, useState } from "react";
import { useGame } from "../../context/GameContext";
import { useTypewriter } from "../../hooks/useTypewriter";

const DM_STATUS_WORDS = [
  "consulting the lore",
  "rolling dice",
  "crafting narrative",
  "checking your stats",
  "weaving the plot",
  "planning your doom",
  "invoking bedrock",
  "thinking",
];

function DmThinking({ isNewCampaign }: { isNewCampaign: boolean }) {
  const [wordIdx, setWordIdx] = useState(0);
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const id = setInterval(() => setWordIdx((i) => (i + 1) % DM_STATUS_WORDS.length), 1800);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setDotCount((d) => (d % 3) + 1), 450);
    return () => clearInterval(id);
  }, []);

  const dots = ".".repeat(dotCount);

  return (
    <div className="mt-1">
      <p className="text-[#6644aa] text-sm">
        {isNewCampaign ? "Initialising campaign" : "The DM stirs in the neon dark"}
        <span className="text-[#00ffcc]">{dots}</span>
      </p>
      <p className="text-[#6644aa]/50 text-xs mt-1 pl-2 font-mono">
        ↳ {DM_STATUS_WORDS[wordIdx]}{dots}
      </p>
    </div>
  );
}

function HistoryEntry({ text }: { text: string }) {
  return (
    <p className="text-[#c8ccd4]/60 text-sm leading-relaxed border-b border-[#1a1a2e]/60 pb-2 mb-2">
      {text}
    </p>
  );
}

function CurrentEntry({ text }: { text: string }) {
  const { displayed, done } = useTypewriter(text, 15);

  return (
    <p className="text-[#c8ccd4] text-sm leading-relaxed">
      {displayed}
      {!done && <span className="cursor-blink text-[#00ffcc]">▌</span>}
    </p>
  );
}

export function NarrativeDisplay() {
  const { state } = useGame();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.narrativeHistory.length, state.isProcessing]);

  const history = state.narrativeHistory;
  const pastEntries = history.slice(0, -1);
  const currentEntry = history[history.length - 1];
  const isNewCampaign = state.isProcessing && !state.turnsPlayed;

  return (
    <div
      ref={scrollRef}
      className="flex-1 border border-[#00ffcc]/30 rounded bg-[#080810] p-3 overflow-y-auto min-h-0 glow-teal"
    >
      {history.length === 0 && !state.isProcessing && (
        <p className="text-[#6644aa]/70 text-sm text-center mt-4">
          Select a character class to begin your adventure in Neo-Pawsburg.
        </p>
      )}

      {pastEntries.map((entry) => (
        <HistoryEntry key={entry.id} text={entry.text} />
      ))}

      {currentEntry && <CurrentEntry text={currentEntry.text} />}

      {state.isProcessing && (
        <DmThinking isNewCampaign={isNewCampaign} />
      )}
    </div>
  );
}
