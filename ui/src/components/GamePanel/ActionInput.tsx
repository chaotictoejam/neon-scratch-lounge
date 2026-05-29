import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { useGame } from "../../context/GameContext";
import { useApi } from "../../hooks/useApi";
import { PLACEHOLDER_ACTIONS } from "../../types";

export function ActionInput() {
  const { state } = useGame();
  const { submitAction } = useApi();
  const [value, setValue] = useState("");
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cycle placeholder text
  useEffect(() => {
    const id = setInterval(() => {
      setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_ACTIONS.length);
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const disabled = state.isProcessing || !state.campaignId;

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    submitAction(trimmed);
    setValue("");
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div
      className={`border rounded flex items-center bg-[#080810] transition-all ${
        disabled ? "border-[#1a1a2e] opacity-50" : "border-[#00ffcc]/40 glow-teal"
      }`}
    >
      <span className="text-[#00ffcc] px-2 font-bold text-sm select-none">›</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        disabled={disabled}
        placeholder={
          state.isProcessing
            ? "Processing turn..."
            : !state.campaignId
            ? "Start a new game above to play ↑"
            : PLACEHOLDER_ACTIONS[placeholderIdx]
        }
        className="flex-1 bg-transparent text-[#c8ccd4] text-sm py-2 outline-none placeholder-[#6644aa]/60 disabled:cursor-not-allowed"
        autoComplete="off"
        spellCheck="false"
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="text-xs border-l border-[#00ffcc]/20 px-3 py-2 text-[#00ffcc]/70 hover:text-[#00ffcc] hover:bg-[#00ffcc]/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all shrink-0"
      >
        SEND ↵
      </button>
    </div>
  );
}
