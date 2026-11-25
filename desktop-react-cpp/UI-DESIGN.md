# Cutting workbench / UI 1.5

## Brief

Refine the existing bilingual React/Electron cutting planner. Preserve the C++
1.4 algorithm, every special end segment, existing inventory and the Excel
export contract. The operator's main questions are what to cut, how many rolls
to open, and which usable lengths remain.

## Direction

A production workbench, not a marketing page. Left-aligned inputs in a compact
350–380px column; the cutting plan owns the remaining width. The distinctive
element is the actual cutting strip: every product, end filler and remainder
is a separate labelled cell. Equal cell widths are explicitly not to scale.

```
Brand + version                         Language | Export | Calculate
Roll length             Reusable threshold             Pitch
Orders / Inventory      Roll count | Scrap | Reusable lengths
Paste / Manual          Material balance
Editable order list     Visual cuts / Per-roll table / Inventory
                        Filters + search
                        Actual labelled cutting sequences
```

## Tokens

- Ink #172E3B; secondary text #526674.
- Canvas #EFF3F5; surface #FFFFFF; rule #D6E0E4.
- Action #086E68; reusable material #236B4D; end scrap #94600E.
- Typography: Segoe UI Variable/Segoe UI on Windows, Microsoft JhengHei for
  Chinese; use tabular figures for lengths. No network fonts or new packages.
- 4/8px spacing rhythm, 12px panel radius, smaller 6px control radius. Flat
  structural divisions rather than identical floating metric cards.

## Behaviour

- Keep all cuts accessible through grouped visual plans and paginated tables.
- Make reusable remainder count and longest remaining piece visible.
- Provide labels, keyboard focus, input errors and an announced calculation state.
- Changing orders, inventory or settings marks the old plan out of date and
  disables its export until recalculated. Old results retain their input snapshot.
- Respect reduced motion and adapt the layout to a narrow viewport; do not
  truncate small end segments or long English labels.

## Skill review

The 1.7 inventory form places labelled length and quantity fields above one
full-width Add offcut action, with quantity reset to 1 after adding. Invalid
values retain both fields for correction; errors link to the affected input.
Each piece remains independent stock. Excel highlights only reusable status
cells in pale yellow, leaving green remainder lengths and other sheets intact.

The 1.6 refinement uses one order-wide length palette shared by React and
Excel, with readable dark labels and separate green remainder/orange filler
treatments. The Excel generic colour legend is removed. Whole new rolls are
sorted by descending product length/count and exact physical pattern; product
and pitch views share one permutation. No cut sequence or inventory ID moves.

ui-ux-pro-max's verified inventory palette and flat dashboard guidance fit the
tool. Its marketing-page layout and unrelated literary font suggestions do
not; they are not adopted or persisted as a generated design system. Use the
verified Web error-summary and React derived-state guidance. frontend-design
informs the quiet chrome and subject-specific cutting-strip treatment. This
replaces the generic four-card summary/gradient treatment with actual material
and production information, without introducing decoration or remote assets.
