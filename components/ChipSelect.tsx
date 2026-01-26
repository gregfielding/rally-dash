"use client";

import { useState, useRef, useEffect } from "react";

interface ChipSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  maxSelections?: number;
  disabled?: boolean;
}

export default function ChipSelect({
  options,
  selected,
  onChange,
  placeholder = "Search and select...",
  maxSelections,
  disabled = false,
}: ChipSelectProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(
    (opt) =>
      opt.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !selected.includes(opt)
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (option: string) => {
    if (maxSelections && selected.length >= maxSelections) return;
    onChange([...selected, option]);
    setSearchTerm("");
    setIsOpen(false);
  };

  const handleRemove = (option: string) => {
    onChange(selected.filter((s) => s !== option));
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex flex-wrap gap-2 min-h-[42px] p-2 border border-gray-300 rounded-lg bg-white">
        {selected.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
          >
            {item}
            {!disabled && (
              <button
                type="button"
                onClick={() => handleRemove(item)}
                className="text-blue-600 hover:text-blue-800 focus:outline-none"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (!maxSelections || selected.length < maxSelections) && (
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchTerm.trim()) {
                e.preventDefault();
                // Try to find exact match first
                const exactMatch = options.find(
                  opt => opt.toLowerCase() === searchTerm.trim().toLowerCase()
                );
                if (exactMatch) {
                  handleSelect(exactMatch);
                } else if (filteredOptions.length > 0) {
                  // Select first filtered option
                  handleSelect(filteredOptions[0]);
                } else {
                  // If no match, add the typed value as-is (for freeform input)
                  if (!maxSelections || selected.length < maxSelections) {
                    onChange([...selected, searchTerm.trim()]);
                    setSearchTerm("");
                    setIsOpen(false);
                  }
                }
              }
            }}
            placeholder={selected.length === 0 ? placeholder : ""}
            className="flex-1 min-w-[120px] outline-none text-sm"
          />
        )}
      </div>

      {isOpen && !disabled && filteredOptions.length > 0 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
          {filteredOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleSelect(option)}
              className="w-full text-left px-4 py-2 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none text-sm text-gray-900"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {maxSelections && selected.length >= maxSelections && (
        <p className="mt-1 text-xs text-gray-500">
          Maximum {maxSelections} selection{maxSelections !== 1 ? "s" : ""} reached
        </p>
      )}
    </div>
  );
}

