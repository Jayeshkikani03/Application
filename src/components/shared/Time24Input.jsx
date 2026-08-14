import { jsx, jsxs } from "react/jsx-runtime";
import { ScrollableSelect } from "./ScrollableSelect";

const HOURS_24 = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

export function splitTimeOnlyValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { hour: "", minute: "" };
  // Accept HH:mm or HH:mm:ss from stored CRF values.
  const [hour = "", minute = ""] = raw.split(":");
  const hh = hour.padStart(2, "0");
  const mm = minute.padStart(2, "0");
  return {
    hour: HOURS_24.includes(hh) ? hh : "",
    minute: MINUTES.includes(mm) ? mm : ""
  };
}

/**
 * Desktop-style HH:mm picker (scrollable hour/minute columns).
 * Used for CRF time fields on all viewports so mobile/tablet match desktop.
 */
export function Time24Input({
  value,
  onChange,
  disabled = false,
  allowEmpty = true,
  id,
  className = "",
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy
}) {
  const { hour, minute } = splitTimeOnlyValue(value);
  const displayHour = allowEmpty ? hour : (hour || "00");
  const displayMinute = allowEmpty ? minute : (minute || "00");
  const updateTime = (nextHour, nextMinute) => {
    if (disabled) return;
    if (allowEmpty && !nextHour && !nextMinute) {
      onChange("");
      return;
    }
    onChange(`${nextHour || "00"}:${nextMinute || "00"}`);
  };
  return /* @__PURE__ */ jsxs("div", {
    id,
    className: ["time-24", "datetime-24__time", className].filter(Boolean).join(" "),
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedBy,
    children: [
      /* @__PURE__ */ jsx(ScrollableSelect, {
        className: "scrollable-select--compact",
        value: displayHour,
        onChange: (nextHour) => updateTime(
          nextHour,
          displayMinute || (nextHour ? "00" : "")
        ),
        options: HOURS_24,
        allowEmpty,
        placeholder: "--",
        ariaLabel: "Hour in 24-hour format",
        disabled
      }),
      /* @__PURE__ */ jsx("span", { children: ":" }),
      /* @__PURE__ */ jsx(ScrollableSelect, {
        className: "scrollable-select--compact",
        value: displayMinute,
        onChange: (nextMinute) => updateTime(
          displayHour || (nextMinute ? "00" : ""),
          nextMinute
        ),
        options: MINUTES,
        allowEmpty,
        placeholder: "--",
        ariaLabel: "Minute",
        disabled
      })
    ]
  });
}

export { HOURS_24, MINUTES };
