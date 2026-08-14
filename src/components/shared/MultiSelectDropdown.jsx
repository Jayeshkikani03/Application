import { useEffect, useRef, useState } from "react";

function MultiSelectDropdown({
  label,
  options,
  selectedValues,
  onChange,
  onSelectAll,
  onClear,
  placeholder = "Select...",
  disabled = false,
  getOptionLabel = (opt) => String(opt),
  getOptionValue = (opt) => opt
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOptions = options.filter((opt) => selectedValues.includes(getOptionValue(opt)));

  let displayText = placeholder;
  if (selectedOptions.length > 0) {
    if (selectedOptions.length === options.length) {
      displayText = "All Selected";
    } else {
      displayText = selectedOptions.map((opt) => getOptionLabel(opt)).join(", ");
    }
  }

  return (
    <div className="multiselect-dropdown-container" ref={containerRef}>
      <div
        className={`multiselect-trigger ${isOpen ? "multiselect-trigger--active" : ""}${disabled ? " multiselect-trigger--disabled" : ""}`}
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            setIsOpen(!isOpen);
          }
        }}
      >
        <span className="multiselect-trigger__text" title={displayText}>
          {displayText}
        </span>
        <span className="multiselect-trigger__arrow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {isOpen && !disabled && (
        <div className="multiselect-dropdown">
          <div className="checkbox-select__header">
            <span>{label}</span>
            <div className="checkbox-select__actions">
              <button type="button" onClick={onSelectAll}>
                Select All
              </button>
              <button type="button" onClick={onClear}>
                Clear
              </button>
            </div>
          </div>
          <div className="checkbox-select__list" role="group" aria-label={label}>
            {options.map((option) => {
              const val = getOptionValue(option);
              const isChecked = selectedValues.includes(val);
              return (
                <label key={val} className="checkbox-select__option">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onChange(val)}
                  />
                  <span>{getOptionLabel(option)}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export { MultiSelectDropdown };
