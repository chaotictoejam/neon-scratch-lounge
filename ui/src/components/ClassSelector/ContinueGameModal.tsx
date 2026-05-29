import { useGame } from "../../context/GameContext";
import { CLASS_META, CharacterClass } from "../../types";
import { formatLocation } from "../../utils/formatters";

interface Props {
  onContinue: () => void;
  onNewGame: () => void;
}

export function ContinueGameModal({ onContinue, onNewGame }: Props) {
  const { state } = useGame();

  const cls = state.characterClass;
  const meta = cls ? CLASS_META[cls as CharacterClass] : null;
  const stats = state.playerStats;

  const hpPct = stats ? Math.max(0, Math.min(100, (stats.hp / stats.maxHp) * 100)) : 0;
  const hpColor = hpPct > 60 ? "#00cc88" : hpPct > 20 ? "#ffaa00" : "#ff003c";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="border border-[#00ffcc]/40 rounded-lg bg-[#0a0a0f] p-6 w-[420px] max-w-full mx-4 glow-teal">

        <div className="text-[#6644aa] text-xs tracking-widest uppercase mb-4">
          ◈ OPERATIVE FOUND
        </div>

        <div className="flex items-center gap-3 mb-5">
          <span className="text-4xl">{meta?.emoji ?? "?"}</span>
          <div>
            <div className="text-[#00ffcc] font-bold text-xl text-glow-teal">
              {state.characterName ?? "—"}
            </div>
            <div className="text-[#6644aa] text-xs uppercase tracking-wider">
              {meta?.label ?? "Unknown class"}
            </div>
          </div>
          {stats && (
            <div className="ml-auto text-right">
              <div className="text-[#ffaa00] text-sm font-bold">LVL {stats.level}</div>
              <div className="text-[#6644aa] text-xs">{stats.xp}/{stats.level * 100} XP</div>
            </div>
          )}
        </div>

        {stats && (
          <div className="space-y-3 mb-5 border border-[#1a1a2e] rounded p-3 bg-[#0d0d18]">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-[#6644aa]">HP</span>
                <span className="text-[#c8ccd4]">{stats.hp}/{stats.maxHp}</span>
              </div>
              <div className="h-2 bg-[#0d0d18] rounded border border-[#1a1a2e] overflow-hidden">
                <div
                  className="h-full rounded transition-all"
                  style={{ width: `${hpPct}%`, backgroundColor: hpColor, boxShadow: `0 0 6px ${hpColor}44` }}
                />
              </div>
            </div>

            <div className="flex justify-between text-xs">
              <span className="text-[#6644aa]">Last seen</span>
              <span className="text-[#c8ccd4]">{formatLocation(state.location) || "—"}</span>
            </div>

            <div className="flex justify-between text-xs">
              <span className="text-[#6644aa]">Turns played</span>
              <span className="text-[#c8ccd4]">{state.turnsPlayed}</span>
            </div>

            <div className="flex justify-between text-xs">
              <span className="text-[#6644aa]">CreditChips</span>
              <span className="text-[#ffaa00]">💰 {stats.gold}</span>
            </div>
          </div>
        )}

        {state.gameOver && (
          <div className="text-[#ff003c] text-xs text-center mb-4 border border-[#ff003c]/30 rounded p-2">
            This campaign ended ({state.gameOverReason === "victory" ? "victory" : "game over"}).
            You can start a new one.
          </div>
        )}

        <div className="flex gap-3">
          {!state.gameOver && (
            <button
              onClick={onContinue}
              className="flex-1 border border-[#00ffcc]/60 text-[#00ffcc] py-2.5 rounded font-bold text-sm hover:bg-[#00ffcc]/10 hover:glow-teal transition-all tracking-wider"
            >
              CONTINUE MISSION
            </button>
          )}
          <button
            onClick={onNewGame}
            className={`${state.gameOver ? "flex-1" : ""} border border-[#6644aa]/50 text-[#6644aa] py-2.5 px-4 rounded text-sm hover:border-[#ff00aa]/60 hover:text-[#ff00aa] transition-all`}
          >
            {state.gameOver ? "NEW MISSION" : "NEW GAME"}
          </button>
        </div>

        <div className="text-[#1a1a2e] text-[10px] font-mono mt-3 text-center select-all hover:text-[#6644aa]/40 transition-colors">
          {state.campaignId}
        </div>
      </div>
    </div>
  );
}
