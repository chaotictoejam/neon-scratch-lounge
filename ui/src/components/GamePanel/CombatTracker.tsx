import { useGame } from "../../context/GameContext";
import { Combatant } from "../../types";

function EnemyRow({ enemy }: { enemy: Combatant }) {
  const pct = Math.max(0, Math.min(100, (enemy.hp / enemy.maxHp) * 100));
  const color = pct > 50 ? "#ff4444" : pct > 25 ? "#ffaa00" : "#ff00aa";
  const glow = pct > 50 ? "rgba(255,68,68,0.4)" : pct > 25 ? "rgba(255,170,0,0.4)" : "rgba(255,0,170,0.4)";

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-[#ff4444]/80 shrink-0 w-3">▸</span>
      <span className="text-[#c8ccd4]/90 shrink-0 w-36 truncate">{enemy.name}</span>
      <div className="relative flex-1 h-2 bg-[#0d0d18] rounded border border-[#1a1a2e] overflow-hidden">
        <div
          className="h-full rounded transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 6px ${glow}` }}
        />
      </div>
      <span className="text-[#c8ccd4]/60 shrink-0 w-16 text-right font-mono">
        {enemy.hp}/{enemy.maxHp}
      </span>
    </div>
  );
}

export function CombatTracker() {
  const { state } = useGame();
  if (state.combatants.length === 0) return null;

  return (
    <div className="border border-[#ff4444]/40 rounded bg-[#0d0d18] p-3 shrink-0">
      <div className="flex items-center gap-2 mb-2 pb-1 border-b border-[#1a1a2e]">
        <span className="text-[#ff4444] text-xs font-bold tracking-wider uppercase" style={{ textShadow: "0 0 8px rgba(255,68,68,0.7)" }}>
          ⚔ ENEMY CONTACTS
        </span>
        <span className="text-[#ff4444]/30 text-[10px] ml-auto">DM SCREEN ▶</span>
      </div>
      <div className="space-y-1.5">
        {state.combatants.map((enemy, i) => (
          <EnemyRow key={i} enemy={enemy} />
        ))}
      </div>
    </div>
  );
}
