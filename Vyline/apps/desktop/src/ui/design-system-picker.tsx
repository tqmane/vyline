import { DESIGN_SYSTEMS, useDesignSystemStore } from "./design-system-store";

export function DesignSystemPicker() {
  const mode = useDesignSystemStore((state) => state.mode);
  const appearance = useDesignSystemStore((state) => state.appearance);
  const setMode = useDesignSystemStore((state) => state.setMode);
  const setAppearance = useDesignSystemStore((state) => state.setAppearance);
  return (
    <section className="vy-design-picker" aria-labelledby="design-system-title">
      <h3 id="design-system-title">インターフェイス</h3>
      <p>画面の構成、コントロール、動きを選択します。</p>
      <fieldset className="vy-design-options">
        <legend className="sr-only">UIスタイル</legend>
        {DESIGN_SYSTEMS.map(({ id, name, description }) => (
          <label key={id} className="vy-design-option" data-selected={mode === id}>
            <input
              type="radio"
              name="design-system"
              value={id}
              checked={mode === id}
              onChange={() => setMode(id)}
            />
            <span className="vy-design-swatch" data-style={id} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>
              <strong>{name}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {mode !== "legacy" && (
        <fieldset className="vy-appearance-options">
          <legend>外観</legend>
          {(
            [
              ["system", "システム"],
              ["light", "ライト"],
              ["dark", "ダーク"],
            ] as const
          ).map(([id, label]) => (
            <label key={id}>
              <input
                type="radio"
                name="design-appearance"
                checked={appearance === id}
                onChange={() => setAppearance(id)}
              />
              {label}
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}
