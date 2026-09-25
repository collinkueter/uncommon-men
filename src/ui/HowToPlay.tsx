import "./HowToPlay.css";

export function HowToPlay({ instructions }: { instructions: string }) {
  if (!instructions.trim()) return null;

  return (
    <details className="how-to-play">
      <summary>How to play</summary>
      <div className="how-to-play-content">{instructions}</div>
    </details>
  );
}
