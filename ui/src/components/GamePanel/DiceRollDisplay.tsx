import { useEffect, useState } from "react";
import { useGame } from "../../context/GameContext";
import { useDiceAnimation } from "../../hooks/useDiceAnimation";
import { DiceRoll } from "../../types";

function SingleRoll({ roll }: { roll: DiceRoll }) {
  const isNat20 = roll.rolls.includes(20) && roll.rolls.length === 1;
  const isNat1 = roll.rolls.includes(1) && roll.rolls.length === 1 && roll.total < 5;
  const { animatedValues, settled } = useDiceAnimation(roll.rolls);

  const borderClass = isNat20
    ? "border-[#ffaa00] glow-amber"
    : isNat1
    ? "border-red-500 glow-red"
    : "border-[#00ffcc]/40 glow-teal";

  return (
    <div className={`border rounded bg-[#080810] p-3 ${borderClass}`}>
      <div className="text-xs text-[#6644aa] mb-2 uppercase tracking-wider">
        DICE ROLL: {roll.purpose}
      </div>

      <div className="flex items-center gap-2 mb-2">
        {animatedValues.map((v, i) => (
          <div
            key={i}
            className={`w-10 h-10 border rounded flex items-center justify-center text-lg font-bold ${
              settled ? "dice-settle" : ""
            } ${
              isNat20
                ? "border-[#ffaa00] text-[#ffaa00]"
                : isNat1
                ? "border-red-400 text-red-400"
                : "border-[#00ffcc]/60 text-[#00ffcc]"
            }`}
          >
            {v}
          </div>
        ))}
        <span className="text-[#6644aa] text-xs ml-1">
          {roll.rolls.map((_, i) => `d${roll.rolls[i] <= 6 ? "6" : "20"}`).join(" + ")}
        </span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {roll.rolls.map((v, i) => (
          <span key={i} className={settled ? "text-[#c8ccd4]" : "text-[#6644aa]"}>
            {i > 0 && <span className="text-[#6644aa] mx-1">+</span>}
            {v}
          </span>
        ))}
        {roll.statBonus > 0 && (
          <>
            <span className="text-[#6644aa]">+</span>
            <span className="text-[#c8ccd4]">{roll.statBonus} (stat)</span>
          </>
        )}
        {roll.modifier !== 0 && (
          <>
            <span className="text-[#6644aa]">{roll.modifier > 0 ? "+" : ""}</span>
            <span className="text-[#c8ccd4]">{roll.modifier}</span>
          </>
        )}
        <span className="text-[#6644aa] mx-1">=</span>
        <div
          className={`border px-2 py-0.5 rounded font-bold ${
            settled ? "total-flash border-[#ffaa00]/60" : "border-[#6644aa]/40 text-[#6644aa]"
          }`}
        >
          {settled
            ? roll.total
            : roll.rolls.reduce((a, b) => a + b, 0) + roll.statBonus + roll.modifier}
        </div>

        {settled && (isNat20 || isNat1) && (
          <span
            className={`text-xs font-bold ml-2 ${
              isNat20 ? "text-[#ffaa00] text-glow-amber" : "text-red-400"
            }`}
          >
            {isNat20 ? "✓ CRITICAL HIT" : "✗ CRITICAL MISS"}
          </span>
        )}
      </div>
    </div>
  );
}

export function DiceRollDisplay() {
  const { state } = useGame();
  const [expanded, setExpanded] = useState(true);

  // Auto-expand whenever new rolls arrive
  useEffect(() => {
    if (state.diceRolls.length > 0) setExpanded(true);
  }, [state.diceRolls]);

  if (!state.diceRolls.length) return null;

  return (
    <div className="border border-[#6644aa]/40 rounded bg-[#080810]">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-[#6644aa] hover:text-[#c8ccd4] transition-colors"
      >
        <span className="uppercase tracking-widest">
          ◈ Dice Rolls ({state.diceRolls.length})
        </span>
        <span>{expanded ? "▲ hide" : "▼ show"}</span>
      </button>

      {expanded && (
        <div className="space-y-2 px-3 pb-3">
          {state.diceRolls.map((roll, i) => (
            <SingleRoll key={i} roll={roll} />
          ))}
        </div>
      )}
    </div>
  );
}
