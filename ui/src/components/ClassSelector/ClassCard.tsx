import { CharacterClass, CLASS_META } from "../../types";

function StatMiniBar({ value, max = 9 }: { value: number; max?: number }) {
  const pct = (value / max) * 100;
  return (
    <div className="h-1.5 bg-[#1a1a2e] rounded overflow-hidden">
      <div
        className="h-full rounded bg-[#00ffcc]"
        style={{ width: `${pct}%`, boxShadow: "0 0 4px rgba(0,255,204,0.5)" }}
      />
    </div>
  );
}

export function ClassCard({
  cls,
  onClick,
}: {
  cls: CharacterClass;
  onClick: () => void;
}) {
  const meta = CLASS_META[cls];

  return (
    <button
      onClick={onClick}
      className="group border border-[#00ffcc]/25 rounded bg-[#0d0d18] p-4 text-left transition-all duration-200
        hover:border-[#00ffcc]/80 hover:scale-105 hover:glow-teal hover:bg-[#0d1520] focus:outline-none"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-3xl">{meta.emoji}</span>
        <span className="text-[#00ffcc] font-bold text-sm group-hover:text-glow-teal">
          {meta.label.toUpperCase()}
        </span>
      </div>

      <p className="text-[#c8ccd4]/70 text-xs mb-3 leading-relaxed">{meta.description}</p>

      <div className="space-y-1.5 mb-3">
        {(["str", "agi", "arc", "stl"] as const).map((stat) => (
          <div key={stat} className="flex items-center gap-2">
            <span className="text-[#6644aa] text-xs w-6 uppercase">{stat}</span>
            <div className="flex-1">
              <StatMiniBar value={meta.stats[stat]} />
            </div>
            <span className="text-[#c8ccd4]/60 text-xs w-3">{meta.stats[stat]}</span>
          </div>
        ))}
      </div>

      <div className="border-t border-[#1a1a2e] pt-2">
        <span className="text-[#ff00aa]/70 text-xs">✦ {meta.ability}</span>
      </div>
    </button>
  );
}
