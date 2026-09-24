import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import "./ThemedSelect.css";

export type ThemedSelectOption = {
  value: string;
  label: string;
};

export type ThemedSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: ThemedSelectOption[];
  label: string;
  id?: string;
  className?: string;
  disabled?: boolean;
};

type Placement = "above" | "below";

const TYPEAHEAD_TIMEOUT = 650;

export function ThemedSelect({
  value,
  onChange,
  options,
  label,
  id,
  className = "",
  disabled = false,
}: ThemedSelectProps) {
  const generatedId = useId().replace(/:/g, "");
  const selectId = id ?? `themed-select-${generatedId}`;
  const listboxId = `${selectId}-listbox`;
  const optionId = (index: number) => `${selectId}-option-${index}`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const typeaheadRef = useRef("");
  const typeaheadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<Placement>("below");
  const [maxHeight, setMaxHeight] = useState<number | undefined>();
  const isDisabled = disabled || options.length === 0;

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined;

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const shouldPlaceAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
    setPlacement(shouldPlaceAbove ? "above" : "below");
    setMaxHeight(Math.max(1, Math.min(320, shouldPlaceAbove ? spaceAbove : spaceBelow)));
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    typeaheadRef.current = "";
    clearTimeout(typeaheadTimerRef.current);
  }, []);

  const openSelect = useCallback(() => {
    if (isDisabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [isDisabled, selectedIndex]);

  useEffect(() => {
    setActiveIndex((previous) =>
      previous >= options.length
        ? selectedIndex >= 0
          ? selectedIndex
          : options.length - 1
        : previous,
    );
  }, [options.length, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    updatePlacement();
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) close();
    };
    const handleViewportChange = () => updatePlacement();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [close, open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const option = activeOption;
    if (!option) return;
    const listbox = document.getElementById(listboxId);
    const activeElement = document.getElementById(optionId(activeIndex));
    if (!listbox || !activeElement) return;
    const listboxRect = listbox.getBoundingClientRect();
    const optionRect = activeElement.getBoundingClientRect();
    if (optionRect.top < listboxRect.top) {
      listbox.scrollTop -= listboxRect.top - optionRect.top;
    } else if (optionRect.bottom > listboxRect.bottom) {
      listbox.scrollTop += optionRect.bottom - listboxRect.bottom;
    }
  }, [activeIndex, activeOption, listboxId, open]);

  useEffect(() => {
    if (isDisabled && open) close();
  }, [close, isDisabled, open]);

  useEffect(() => () => clearTimeout(typeaheadTimerRef.current), []);

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
    triggerRef.current?.focus();
  };

  const moveActive = (delta: number) => {
    if (!options.length) return;
    const start = activeIndex >= 0 ? activeIndex : selectedIndex >= 0 ? selectedIndex : 0;
    setActiveIndex((start + delta + options.length) % options.length);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (isDisabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openSelect();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) openSelect();
      setActiveIndex(event.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openSelect();
      else if (activeIndex >= 0) choose(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (event.key === "Tab") {
      if (open) close();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const search = `${typeaheadRef.current}${event.key.toLocaleLowerCase()}`;
      const start = activeIndex >= 0 ? activeIndex + 1 : 0;
      const match = options.findIndex((option, index) =>
        index >= start && option.label.toLocaleLowerCase().startsWith(search),
      );
      const wrappedMatch = match >= 0 ? match : options.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(search),
      );
      if (wrappedMatch >= 0) {
        event.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex(wrappedMatch);
        typeaheadRef.current = search;
        clearTimeout(typeaheadTimerRef.current);
        typeaheadTimerRef.current = setTimeout(() => {
          typeaheadRef.current = "";
        }, TYPEAHEAD_TIMEOUT);
      }
    }
  };

  const popupStyle = maxHeight ? ({ "--themed-select-max-height": `${maxHeight}px` } as CSSProperties) : undefined;

  return (
    <div ref={wrapperRef} className={`themed-select ${className}`.trim()}>
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        className="themed-select__trigger"
        disabled={isDisabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeOption ? optionId(activeIndex) : undefined}
        aria-label={label}
        onClick={() => (open ? close() : openSelect())}
        onKeyDown={handleKeyDown}
      >
        <span className="themed-select__value">{selected?.label ?? "Select an option"}</span>
        <ChevronDown aria-hidden="true" className="themed-select__chevron" />
      </button>
      {open && (
        <div
          className="themed-select__popup"
          data-placement={placement}
          style={popupStyle}
        >
          <div
            id={listboxId}
            className="themed-select__listbox"
            role="listbox"
            aria-label={label}
            tabIndex={-1}
          >
            {options.map((option, index) => (
              <div
                id={optionId(index)}
                key={option.value}
                className="themed-select__option"
                data-active={index === activeIndex || undefined}
                data-selected={option.value === value || undefined}
                role="option"
                aria-selected={option.value === value}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {option.label}
                {option.value === value && <Check aria-hidden="true" className="themed-select__check" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
