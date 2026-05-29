import { useState } from "react";
import { Header } from "./components/Header";
import { CharacterHUD } from "./components/GamePanel/CharacterHUD";
import { NarrativeDisplay } from "./components/GamePanel/NarrativeDisplay";
import { DiceRollDisplay } from "./components/GamePanel/DiceRollDisplay";
import { CombatTracker } from "./components/GamePanel/CombatTracker";
import { InventoryBar } from "./components/GamePanel/InventoryBar";
import { ActionInput } from "./components/GamePanel/ActionInput";
import { WorkflowTrace } from "./components/MechanicsPanel/WorkflowTrace";
import { LogStream } from "./components/MechanicsPanel/LogStream";
import { MetricsStrip } from "./components/MechanicsPanel/MetricsStrip";
import { ClassSelectorModal } from "./components/ClassSelector/ClassSelectorModal";
import { ContinueGameModal } from "./components/ClassSelector/ContinueGameModal";
import { useWorkflowAnimation } from "./hooks/useWorkflowAnimation";
import { useGame } from "./context/GameContext";
import { useMechanics } from "./context/MechanicsContext";

function AppInner() {
  const { state, dispatch } = useGame();
  const { dispatch: mechDispatch } = useMechanics();

  // If there's a saved campaign on load, ask to continue or start fresh
  const [showContinueModal, setShowContinueModal] = useState(!!state.campaignId);
  const [showClassSelector, setShowClassSelector] = useState(!state.campaignId);

  useWorkflowAnimation(state.isProcessing);

  const handleContinue = () => setShowContinueModal(false);

  const handleNewGameFromContinue = () => {
    setShowContinueModal(false);
    dispatch({ type: "RESET" });
    mechDispatch({ type: "RESET_WORKFLOW" });
    setShowClassSelector(true);
  };

  const handleNewGame = () => setShowClassSelector(true);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0f] text-[#c8ccd4] font-mono overflow-hidden">
      <Header />

      <div className="flex flex-1 min-h-0">
        {/* Game Panel — 55% */}
        <div className="flex flex-col gap-2 p-3 overflow-hidden" style={{ width: "55%" }}>
          <CharacterHUD onNewGame={handleNewGame} />
          <CombatTracker />
          <DiceRollDisplay />
          <NarrativeDisplay />
          <InventoryBar />
          <ActionInput />
        </div>

        {/* Divider */}
        <div className="w-px bg-[#1a1a2e] shrink-0 mx-0" />

        {/* AWS Mechanics Panel — 45% */}
        <div
          className="flex flex-col gap-2 p-3 overflow-hidden"
          style={{ width: "45%" }}
        >
          <div className="text-[#ff00aa] text-xs font-bold tracking-widest uppercase text-glow-pink mb-0.5">
            ◈ AWS MECHANICS
          </div>
          <WorkflowTrace />
          <LogStream />
          <MetricsStrip />
        </div>
      </div>

      {showContinueModal && (
        <ContinueGameModal
          onContinue={handleContinue}
          onNewGame={handleNewGameFromContinue}
        />
      )}

      {!showContinueModal && showClassSelector && (
        <ClassSelectorModal onClose={() => setShowClassSelector(false)} />
      )}

      {!showContinueModal && state.gameOver && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/85 backdrop-blur-sm">
          <div className="border border-[#ff00aa]/60 rounded-lg bg-[#0a0a0f] p-8 text-center max-w-sm glow-pink">
            <div className="text-4xl mb-3">
              {state.gameOverReason === "victory" ? "🏆" : "💀"}
            </div>
            <h2 className="text-[#ff00aa] font-bold text-xl mb-2 text-glow-pink">
              {state.gameOverReason === "victory" ? "MISSION COMPLETE" : "GAME OVER"}
            </h2>
            <p className="text-[#c8ccd4]/70 text-sm mb-5">
              {state.gameOverReason === "victory"
                ? "Neo-Pawsburg is safe. For now."
                : "The neon goes dark. Another operative falls."}
            </p>
            <button
              onClick={() => setShowClassSelector(true)}
              className="border border-[#00ffcc]/50 text-[#00ffcc] px-4 py-2 rounded text-sm hover:bg-[#00ffcc]/10 transition-all"
            >
              START NEW GAME
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return <AppInner />;
}
