import { useState, useEffect, useRef } from "react";

export function useTypewriter(text: string, speed = 15): { displayed: string; done: boolean } {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  const indexRef = useRef(0);
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = text;
    indexRef.current = 0;
    setDisplayed("");
    setDone(false);

    if (!text) {
      setDone(true);
      return;
    }

    const id = setInterval(() => {
      indexRef.current += 1;
      setDisplayed(textRef.current.slice(0, indexRef.current));
      if (indexRef.current >= textRef.current.length) {
        clearInterval(id);
        setDone(true);
      }
    }, speed);

    return () => clearInterval(id);
  }, [text, speed]);

  return { displayed, done };
}
