import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";

export function SegmentedChoice<Value extends string>({
  label,
  options,
  value,
  onValueChange,
  size = "default",
  disabled,
}: {
  label: string;
  options: readonly (readonly [value: Value, label: string])[];
  value: Value;
  onValueChange: (value: Value) => void;
  size?: "default" | "sm";
  disabled?: boolean;
}) {
  return (
    <ToggleGroup
      aria-label={label}
      variant="segmented"
      size={size}
      value={[value]}
      disabled={disabled ?? false}
      onValueChange={([selected]) => {
        const option = options.find(([optionValue]) => optionValue === selected);
        if (option) onValueChange(option[0]);
      }}
    >
      {options.map(([optionValue, optionLabel]) => (
        <ToggleGroupItem key={optionValue} value={optionValue}>
          {optionLabel}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
