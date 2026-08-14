import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const LIST_GAP = 2;
const VIEWPORT_PAD = 8;
const PREFERRED_MAX_HEIGHT = 220;

function normalizeSelectOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((option) => {
    if (option && typeof option === "object" && "value" in option) {
      return {
        value: String(option.value),
        label: String(option.label ?? option.value),
      };
    }
    return { value: String(option), label: String(option) };
  });
}

function computeListStyle(triggerEl) {
  const rect = triggerEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD;
  const spaceAbove = rect.top - VIEWPORT_PAD;
  const openUpward = spaceBelow < 120 && spaceAbove > spaceBelow;
  const maxHeight = Math.max(
    80,
    Math.min(PREFERRED_MAX_HEIGHT, (openUpward ? spaceAbove : spaceBelow) - LIST_GAP)
  );
  const minWidth = Math.max(rect.width, 120);
  const maxWidth = window.innerWidth - VIEWPORT_PAD * 2;
  let left = rect.left;
  if (left + minWidth > window.innerWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, window.innerWidth - VIEWPORT_PAD - minWidth);
  }

  return {
    position: "fixed",
    top: openUpward ? undefined : rect.bottom + LIST_GAP,
    bottom: openUpward ? window.innerHeight - rect.top + LIST_GAP : undefined,
    left,
    minWidth,
    maxWidth: Math.min(maxWidth, window.innerWidth - left - VIEWPORT_PAD),
    maxHeight,
    zIndex: 200,
  };
}

export function ScrollableSelect({
  value,
  onChange,
  options = [],
  placeholder = "Select...",
  allowEmpty = true,
  disabled = false,
  className = "",
  id,
  ariaLabel,
  searchable = false,
}) {
  const [open, setOpen] = useState(false);
  const [listStyle, setListStyle] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const searchInputRef = useRef(null);
  const listId = useId();
  const triggerId = id ?? `scrollable-select-${listId}`;
  const normalizedOptions = useMemo(() => normalizeSelectOptions(options), [options]);
  const selectableOptions = useMemo(() => {
    if (!allowEmpty) return normalizedOptions;
    return normalizedOptions.filter((option) => option.value !== "");
  }, [allowEmpty, normalizedOptions]);

  const filteredOptions = useMemo(() => {
    if (!searchable || !searchTerm) return selectableOptions;
    const term = searchTerm.toLowerCase();
    return selectableOptions.filter(
      (option) =>
        option.label.toLowerCase().includes(term) ||
        option.value.toLowerCase().includes(term)
    );
  }, [selectableOptions, searchTerm, searchable]);

  const stringValue = value == null ? "" : String(value);
  const selectedOption = selectableOptions.find((option) => option.value === stringValue);
  const displayLabel = selectedOption?.label ?? (stringValue || placeholder);
  const hasValue = Boolean(selectedOption);

  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (!open) {
      setInputValue(selectedOption ? selectedOption.label : "");
      setSearchTerm("");
    }
  }, [open, selectedOption]);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    setSearchTerm(val);
    if (!open) {
      setOpen(true);
    }
  };

  const handleInputFocus = () => {
    if (disabled) return;
    setOpen(true);
    setTimeout(() => {
      triggerRef.current?.select();
    }, 50);
  };



  const updateListPosition = () => {
    if (!triggerRef.current) return;
    setListStyle(computeListStyle(triggerRef.current));
  };

  useLayoutEffect(() => {
    if (!open) {
      setListStyle(null);
      return undefined;
    }
    updateListPosition();
    window.addEventListener("resize", updateListPosition);
    window.addEventListener("scroll", updateListPosition, true);
    return () => {
      window.removeEventListener("resize", updateListPosition);
      window.removeEventListener("scroll", updateListPosition, true);
    };
  }, [open, selectableOptions.length]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (
        !rootRef.current?.contains(event.target) &&
        !listRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const handleSelect = (nextValue) => {
    if (disabled) return;
    onChange(nextValue);
    setOpen(false);
  };

  const toggleOpen = () => {
    if (disabled) return;
    setOpen((current) => !current);
  };

  const listMarkup = open && listStyle ? (
    <ul
      ref={listRef}
      className="scrollable-select__list scrollable-select__list--portal"
      id={listId}
      role="listbox"
      aria-labelledby={triggerId}
      style={listStyle}
    >
      {allowEmpty && !searchTerm && (
        <li role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={!stringValue}
            className={`scrollable-select__option${!stringValue ? " scrollable-select__option--selected" : ""}`}
            onClick={() => handleSelect("")}
          >
            {placeholder}
          </button>
        </li>
      )}
      {filteredOptions.length > 0 ? (
        filteredOptions.map((option) => (
          <li key={option.value} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={stringValue === option.value}
              className={`scrollable-select__option${
                stringValue === option.value ? " scrollable-select__option--selected" : ""
              }`}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </button>
          </li>
        ))
      ) : (
        <li role="presentation" className="scrollable-select__empty">
          No matches found
        </li>
      )}
    </ul>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`scrollable-select${open ? " scrollable-select--open" : ""}${
        disabled ? " scrollable-select--disabled" : ""
      }${className ? ` ${className}` : ""}`}
    >
      {searchable ? (
        <div className="scrollable-select__combobox">
          <input
            ref={triggerRef}
            type="text"
            id={triggerId}
            className="scrollable-select__trigger scrollable-select__input"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={ariaLabel}
            disabled={disabled}
            placeholder={placeholder}
            value={inputValue}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            onClick={() => setOpen(true)}
          />
        </div>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          id={triggerId}
          className="scrollable-select__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={toggleOpen}
        >
          <span className={hasValue ? "scrollable-select__value" : "scrollable-select__placeholder"}>
            {displayLabel}
          </span>
        </button>
      )}
      {listMarkup && createPortal(listMarkup, document.body)}
    </div>
  );
}
