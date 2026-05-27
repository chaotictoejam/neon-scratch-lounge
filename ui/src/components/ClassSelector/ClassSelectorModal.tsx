import { CharacterClass } from "../../types";
import { ClassCard } from "./ClassCard";
import { useApi } from "../../hooks/useApi";

const CLASSES: CharacterClass[] = ["TabbyWarrior", "SiameseMage", "MaineCoonPaladin", "SphinxRogue"];

interface Props {
  onClose: () => void;
}

export function ClassSelectorModal({ onClose }: Props) {
  const { submitAction } = useApi();

  const handleSelect = (cls: CharacterClass) => {
    submitAction("new-game", cls);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="border border-[#00ffcc]/40 rounded-lg bg-[#0a0a0f] p-6 w-[680px] max-w-full mx-4 glow-teal">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-[#00ffcc] font-bold text-lg tracking-widest text-glow-teal">
              SELECT YOUR CLASS
            </h2>
            <p className="text-[#6644aa] text-xs mt-0.5">Choose your operative for Neo-Pawsburg</p>
          </div>
          <button
            onClick={onClose}
            className="text-[#6644aa] hover:text-[#c8ccd4] text-lg transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {CLASSES.map((cls) => (
            <ClassCard key={cls} cls={cls} onClick={() => handleSelect(cls)} />
          ))}
        </div>

        <p className="text-[#6644aa]/50 text-xs text-center mt-4">
          Tip: SphinxRogue (Sandpaw) is ideal for demo — high AGI and STL make dice rolls exciting.
        </p>
      </div>
    </div>
  );
}
