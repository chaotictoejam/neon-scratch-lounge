import { useRef, useEffect } from "react";
import { useMechanics } from "../../context/MechanicsContext";
import { LogLine } from "../../types";
import { latencyColor } from "../../utils/formatters";

function LogLineRow({ line, idx }: { line: LogLine; idx: number }) {
  const latClass = latencyColor(line.durationMs);
  const extras = line.extras
    ? Object.entries(line.extras)
        .map(([k, v]) => `${k}:${v}`)
        .join("  ")
    : "";

  return (
    <div
      className={`flex items-baseline gap-2 text-xs font-mono log-line-enter whitespace-nowrap ${
        line.success ? "" : "text-red-400"
      }`}
      style={{ animationDelay: `${idx * 30}ms` }}
    >
      <span className="text-[#6644aa]/70 shrink-0">{line.timestamp}</span>
      <span
        className={`shrink-0 w-32 truncate ${
          line.success ? "text-[#c8ccd4]/80" : "text-red-400"
        }`}
      >
        {line.lambdaName}
      </span>
      <span className={`${latClass} shrink-0 w-14 text-right`}>
        {line.durationMs}ms
      </span>
      <span className={line.success ? "text-[#00ffcc]/70 shrink-0" : "text-red-400 shrink-0"}>
        {line.success ? "✓" : "✗"}
      </span>
      {line.errorType && (
        <span className="text-red-400 shrink-0">{line.errorType}</span>
      )}
      {extras && (
        <span className="text-[#6644aa]/70">{extras}</span>
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
  }, [state.logLines.length]);

  return (
    <div className="border border-[#ff00aa]/20 rounded bg-[#0d0d18] p-3 flex flex-col min-h-0">
      <div className="flex items-center gap-2 mb-2 pb-1 border-b border-[#1a1a2e] shrink-0">
        <span className="text-[#ff00aa] text-xs font-bold tracking-wider uppercase text-glow-pink">
          Live Telemetry
        </span>
        <span className="text-[#1a1a2e]">────────────────────────</span>
      </div>

      <div
        ref={scrollRef}
        className="overflow-y-auto flex-1 space-y-0.5 min-h-0"
        style={{ maxHeight: "160px" }}
      >
        {state.logLines.length === 0 && (
          <p className="text-[#6644aa]/40 text-xs">Awaiting Lambda invocations...</p>
        )}
        {state.logLines.map((line, i) => (
          <LogLineRow key={i} line={line} idx={i} />
        ))}
      </div>
    </div>
  );
}
