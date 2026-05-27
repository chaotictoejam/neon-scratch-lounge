import { useMechanics } from "../../context/MechanicsContext";

export function MetricsStrip() {
  const { state } = useMechanics();
  const { currentTurnMetrics: cur, sessionMetrics: sess } = state;

  const dlqAlert = sess.dlqDepth > 0;

  return (
    <div className="border border-[#ff00aa]/20 rounded bg-[#0d0d18] p-3 space-y-2 text-xs font-mono">
      <div className="space-y-1">
        <div className="flex items-center gap-4 text-[#6644aa]/70 uppercase tracking-wider text-[10px] mb-1">
          <span className="w-32">METRIC</span>
          <span className="w-14 text-right">INPUT</span>
          <span className="w-16 text-right">OUTPUT</span>
          <span className="w-14 text-right">TOTAL</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[#6644aa] w-32">Tokens/turn</span>
          <span className="text-[#c8ccd4] w-14 text-right">{cur.inputTokens}</span>
          <span className="text-[#c8ccd4] w-16 text-right">{cur.outputTokens}</span>
          <span className="text-[#ffaa00] w-14 text-right font-bold">
            {cur.inputTokens + cur.outputTokens}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[#6644aa] w-32">Session total</span>
          <span className="text-[#c8ccd4] w-14 text-right">{sess.totalInputTokens}</span>
          <span className="text-[#c8ccd4] w-16 text-right">{sess.totalOutputTokens}</span>
          <span className="text-[#ffaa00] w-14 text-right font-bold">
            {sess.totalInputTokens + sess.totalOutputTokens}
          </span>
        </div>
      </div>

      {cur.toolCalls.length > 0 && (
        <div className="border-t border-[#1a1a2e] pt-2">
          <span className="text-[#6644aa]">TOOL CALLS/TURN  </span>
          {cur.toolCalls.map((t, i) => (
            <span key={i} className="text-[#c8ccd4] mr-2">{t}</span>
          ))}
        </div>
      )}

      <div className="border-t border-[#1a1a2e] pt-2 flex items-center gap-6">
        <div>
          <span className="text-[#6644aa]">RETRY COUNT  </span>
          <span className={sess.retryCount > 0 ? "text-[#ffaa00] font-bold" : "text-[#c8ccd4]"}>
            {sess.retryCount}
          </span>
        </div>
        <div>
          <span className="text-[#6644aa]">DLQ DEPTH  </span>
          <span
            className={
              dlqAlert
                ? "text-red-400 font-bold animate-pulse"
                : "text-[#c8ccd4]"
            }
          >
            {sess.dlqDepth}
          </span>
          {dlqAlert && (
            <span className="text-red-400 ml-1 animate-pulse">⚠</span>
          )}
        </div>
      </div>
    </div>
  );
}
