import { Component, type ErrorInfo, type ReactNode } from "react";

export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled error in app tree:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#000000",
            color: "#ffffff",
            fontFamily: "sans-serif",
          }}
        >
          Something went wrong. Please refresh the page.
        </div>
      );
    }
    return this.props.children;
  }
}
