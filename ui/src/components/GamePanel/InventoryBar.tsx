import { useGame } from "../../context/GameContext";

export function InventoryBar() {
  const { state } = useGame();

  if (!state.playerStats) return null;

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[#6644aa] mr-1 shrink-0">INVENTORY:</span>
        {state.inventory.length === 0 && (
          <span className="text-[#6644aa]/50">[empty]</span>
        )}
        {state.inventory.map((item, i) => (
          <span
            key={i}
            className="border border-[#00ffcc]/30 text-[#00ffcc]/80 px-1.5 py-0.5 rounded text-xs"
          >
            {item}
          </span>
        ))}
      </div>

      {state.activeEffects.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[#6644aa] mr-1 shrink-0">EFFECTS:</span>
          {state.activeEffects.map((effect, i) => (
            <span
              key={i}
              className="border border-[#ff00aa]/30 text-[#ff00aa]/80 px-1.5 py-0.5 rounded text-xs"
            >
              {effect}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
