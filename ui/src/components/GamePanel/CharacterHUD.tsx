import { useEffect, useState } from "react";
import { useGame } from "../../context/GameContext";
import { CLASS_META, CharacterClass } from "../../types";
import { formatLocation } from "../../utils/formatters";

function StatBar({
  current,
  max,
  label,
}: {
  current: number;
  max: number;
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, (current / max) * 100));
  const color =
    pct > 60 ? "#00cc88" : pct > 20 ? "#ffaa00" : "#ff003c";
  const glowColor =
    pct > 60 ? "rgba(0,204,136,0.4)" : pct > 20 ? "rgba(255,170,0,0.4)" : "rgba(255,0,60,0.4)";
  const shouldPulse = pct <= 20;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[#6644aa] w-6 shrink-0">{label}</span>
      <div className="relative flex-1 h-2 bg-[#0d0d18] rounded border border-[#1a1a2e] overflow-hidden">
        <div
          className={`hp-bar-fill h-full rounded ${shouldPulse ? "animate-pulse" : ""}`}
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            boxShadow: `0 0 6px ${glowColor}`,
          }}
        />
      </div>
      <span className="text-[#c8ccd4] w-14 text-right shrink-0">
        {current}/{max}
      </span>
    </div>
  );
}

export function CharacterHUD({ onNewGame }: { onNewGame: () => void }) {
  const { state, dispatch } = useGame();
  const [levelUpVisible, setLevelUpVisible] = useState(false);

  useEffect(() => {
    if (state.showLevelUp) {
      setLevelUpVisible(true);
      const id = setTimeout(() => {
        setLevelUpVisible(false);
        dispatch({ type: "CLEAR_LEVEL_UP" });
      }, 2000);
      return () => clearTimeout(id);
    }
  }, [state.showLevelUp, dispatch]);

  const cls = state.characterClass;
  const meta = cls ? CLASS_META[cls as CharacterClass] : null;
  const stats = state.playerStats;

  return (
    <div
      className={`relative border border-[#00ffcc]/40 rounded bg-[#0d0d18] p-3 glow-teal ${
        levelUpVisible ? "level-up-flash" : ""
      }`}
    >
      {levelUpVisible && (
        <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
          <span className="text-[#ffaa00] text-3xl font-bold tracking-widest text-glow-amber animate-bounce">
            LEVEL UP!
          </span>
        </div>
      )}

      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{meta?.emoji ?? "?"}</span>
          <div>
            <div className="text-[#00ffcc] font-bold text-sm text-glow-teal">
              {state.characterName ?? "—"}
            </div>
            <div className="text-[#6644aa] text-xs uppercase tracking-wider">
              {meta?.label ?? "Select a class"}
            </div>
          </div>
        </div>
        <button
          onClick={onNewGame}
          className="text-xs border border-[#00ffcc]/50 text-[#00ffcc] px-2 py-0.5 rounded hover:bg-[#00ffcc]/10 hover:glow-teal transition-all"
        >
          [NEW GAME]
        </button>
      </div>

      {stats && (
        <>
          <div className="space-y-1.5 mb-2">
            <StatBar current={stats.hp} max={stats.maxHp} label="HP" />
            <div className="flex items-center gap-2 text-xs">
              <span className="text-[#6644aa] w-6 shrink-0">XP</span>
              <div className="relative flex-1 h-2 bg-[#0d0d18] rounded border border-[#1a1a2e] overflow-hidden">
                <div
                  className="hp-bar-fill h-full rounded"
                  style={{
                    width: `${Math.min(100, (stats.xp / (stats.level * 100)) * 100)}%`,
                    backgroundColor: "#6644aa",
                    boxShadow: "0 0 6px rgba(102,68,170,0.5)",
                  }}
                />
              </div>
              <span className="text-[#c8ccd4] w-14 text-right shrink-0">
                {stats.xp}/{stats.level * 100}
              </span>
              <span className="text-[#ffaa00] text-xs font-bold ml-1 text-glow-amber">
                LVL {stats.level}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[#ffaa00]">
              💰 {stats.gold} CreditChips
            </span>
            <span className="text-[#6644aa]">
              📍 {formatLocation(state.location)}
            </span>
          </div>

          <div className="flex gap-3 text-xs text-[#6644aa]">
            <span>
              STR:<span className="text-[#c8ccd4] ml-0.5">{stats.pawStrength}</span>
            </span>
            <span>
              AGI:<span className="text-[#c8ccd4] ml-0.5">{stats.agility}</span>
            </span>
            <span>
              ARC:<span className="text-[#c8ccd4] ml-0.5">{stats.arcane}</span>
            </span>
            <span>
              STL:<span className="text-[#c8ccd4] ml-0.5">{stats.stealth}</span>
            </span>
          </div>
        </>
      )}

      {!stats && (
        <div className="text-center py-2">
          <span className="text-[#6644aa] text-xs">No active campaign — </span>
          <button
            onClick={onNewGame}
            className="text-[#00ffcc] text-xs underline underline-offset-2 hover:text-glow-teal"
          >
            pick a class to start
          </button>
        </div>
      )}
    </div>
  );
}
