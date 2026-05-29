import { useGame } from "../../context/GameContext";

export function InventoryBar() {
  const { state } = useGame();

  if (!state.playerStats) return null;

  // Stack duplicate item names
  const stackedItems: { name: string; count: number }[] = [];
  for (const item of state.inventory) {
    const existing = stackedItems.find((s) => s.name === item);
    if (existing) {
      existing.count++;
    } else {
      stackedItems.push({ name: item, count: 1 });
    }
  }

  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[#6644aa] mr-1 shrink-0">INVENTORY:</span>
        {stackedItems.length === 0 && (
          <span className="text-[#6644aa]/50">[empty]</span>
        )}
        {stackedItems.map(({ name, count }) => (
          <span
            key={name}
            className="border border-[#00ffcc]/30 text-[#00ffcc]/80 px-1.5 py-0.5 rounded text-xs"
          >
            {name}{count > 1 ? ` ×${count}` : ""}
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
