import { useMechanics } from "../context/MechanicsContext";

export function Header() {
  const { state } = useMechanics();

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a2e] bg-[#0a0a0f] shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-[#00ffcc] text-lg font-bold text-glow-teal">◈</span>
        <span className="text-[#00ffcc] font-bold tracking-widest text-sm text-glow-teal">
          THE NEON SCRATCH LOUNGE
        </span>
      </div>
      <div className="flex items-center gap-3">
        {state.failureInjectionActive && (
          <span className="text-xs font-bold text-red-400 bg-red-900/30 border border-red-500/50 px-2 py-0.5 rounded animate-pulse">
            ⚠ FAILURE INJECTION ACTIVE
          </span>
        )}
        <span className="text-[#6644aa] text-xs tracking-widest font-medium">
          AWS SUMMIT 2026 — DEV201
        </span>
      </div>
    </header>
  );
}
