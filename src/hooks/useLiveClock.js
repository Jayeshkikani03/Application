import { useEffect, useState } from "react";
function useLiveClock(intervalMs = 1e3) {
  const [time, setTime] = useState(
    () => (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", { hour12: false })
  );
  useEffect(() => {
    const id = setInterval(
      () => setTime((/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", { hour12: false })),
      intervalMs
    );
    return () => clearInterval(id);
  }, [intervalMs]);
  return time;
}
function useCountdown(targetIso) {
  const [remaining, setRemaining] = useState("\u2014");
  useEffect(() => {
    if (!targetIso) {
      setRemaining("\u2014");
      return;
    }
    const tick = () => {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("00:00:00");
        return;
      }
      const h = Math.floor(diff / 36e5);
      const m = Math.floor(diff % 36e5 / 6e4);
      const s = Math.floor(diff % 6e4 / 1e3);
      setRemaining(
        `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      );
    };
    tick();
    const id = setInterval(tick, 1e3);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}
export {
  useCountdown,
  useLiveClock
};
