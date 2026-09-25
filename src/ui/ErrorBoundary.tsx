import { Component, type ReactNode } from "react";
import { log } from "@/lib/logging/logger";

// A render error must never leave a competitor looking at a blank screen.
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    log.error("Render failed", { error: error instanceof Error ? error.message : String(error) });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-shell">
        <div className="notice error" role="alert">
          Something went wrong on this screen. Saved results are safe.
        </div>
        <div className="content">
          <button className="button primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
