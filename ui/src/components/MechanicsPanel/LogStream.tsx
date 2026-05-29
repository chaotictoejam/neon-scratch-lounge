import { useRef, useEffect } from "react";
import { useMechanics } from "../../context/MechanicsContext";
import { CwlLogRow } from "../../types";
import { latencyColor } from "../../utils/formatters";

function CwlRow({ row, idx }: { row: CwlLogRow; idx: number }) {
  const ts = row["@timestamp"]?.slice(11, 23) ?? "";
  const success = row.success === "true" || row.success === "1";
  const latMs = row.latencyMs ? Number(row.latencyMs) : null;
  const latClass = latMs !== null ? latencyColor(latMs) : "text-[#6644aa]/60";

  // Infer source lambda from which structured fields are present
  const source = row.toolName
    ? "exec-tool"
    : row.inputTokens
      ? "invoke-dm"
      : "controller";

  return (
    <div
      className={`flex items-baseline gap-2 text-xs font-mono log-line-enter whitespace-nowrap ${
        success ? "" : "text-red-400"
      }`}
      style={{ animationDelay: `${idx * 20}ms` }}
    >
      <span className="text-[#6644aa]/70 shrink-0 w-28">{ts}</span>
      <span className={`shrink-0 w-20 truncate ${success ? "text-[#c8ccd4]/70" : "text-red-400"}`}>
        {source}
      </span>
      {latMs !== null && (
        <span className={`${latClass} shrink-0 w-14 text-right`}>{latMs}ms</span>
      )}
      <span className={success ? "text-[#00ffcc]/70 shrink-0" : "text-red-400 shrink-0"}>
        {success ? "✓" : "✗"}
      </span>
      {row.toolName && (
        <span className="text-[#ffaa00]/80 shrink-0">{row.toolName}</span>
      )}
      {row.toolName === "roll-dice" && row.diceResult && (
        <span className="text-[#00ffcc] shrink-0">🎲{row.diceResult}</span>
      )}
      {!row.toolName && row.inputTokens && (
        <span className="text-[#6644aa]/80">
          in:{row.inputTokens} out:{row.outputTokens}
        </span>
      )}
      {row.retryCount && row.retryCount !== "0" && (
        <span className="text-[#ff00aa]/80 shrink-0">retry:{row.retryCount}</span>
      )}
    </div>
  );
}

export function LogStream() {
  const { state } = useMechanics();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.cwlLogs.length]);

  return (
    <div className="border border-[#ff00aa]/20 rounded bg-[#0d0d18] p-3 flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-2 pb-1 border-b border-[#1a1a2e] shrink-0">
        <span className="text-[#ff00aa] text-xs font-bold tracking-wider uppercase text-glow-pink">
          CloudWatch Logs
        </span>
        <span className="text-[#1a1a2e]">───────────────────────</span>
        {state.cwlLogs.length > 0 && (
          <span className="text-[#6644aa]/60 text-[10px] ml-auto shrink-0">
            {state.cwlLogs.length} events
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="overflow-y-auto flex-1 space-y-0.5 min-h-0"
        style={{ maxHeight: "160px" }}
      >
        {state.cwlLogs.length === 0 && (
          <p className="text-[#6644aa]/40 text-xs">Awaiting Lambda invocations...</p>
        )}
        {state.cwlLogs.map((row, i) => (
          <CwlRow key={i} row={row} idx={i} />
        ))}
      </div>
    </div>
  );
}
