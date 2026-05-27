import { useRef, useEffect } from "react";
import { useGame } from "../../context/GameContext";
import { useTypewriter } from "../../hooks/useTypewriter";

function HistoryEntry({ text }: { text: string }) {
  return (
    <p className="text-[#c8ccd4]/60 text-sm leading-relaxed border-b border-[#1a1a2e]/60 pb-2 mb-2">
      {text}
    </p>
  );
}

function CurrentEntry({ text, isProcessing }: { text: string; isProcessing: boolean }) {
  const { displayed, done } = useTypewriter(text, 15);

  return (
    <p className="text-[#c8ccd4] text-sm leading-relaxed">
      {isProcessing ? (
        <span className="text-[#6644aa]">
          The DM stirs in the neon dark
          <span className="cursor-blink text-[#00ffcc]">▌</span>
        </span>
      ) : (
        <>
          {displayed}
          {!done && <span className="cursor-blink text-[#00ffcc]">▌</span>}
        </>
      )}
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

      {currentEntry && (
        <CurrentEntry text={currentEntry.text} isProcessing={false} />
      )}

      {state.isProcessing && !currentEntry && (
        <CurrentEntry text="" isProcessing={true} />
      )}

      {state.isProcessing && currentEntry && (
        <p className="text-[#6644aa] text-sm mt-2">
          The DM stirs in the neon dark
          <span className="cursor-blink text-[#00ffcc]">▌</span>
        </p>
      )}
    </div>
  );
}
