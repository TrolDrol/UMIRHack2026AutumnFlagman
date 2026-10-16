import { Component, type ReactNode } from "react";
export class StorageBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div role="alert">
        <h2>Не удалось открыть сохранённое состояние</h2>
        <p>{this.state.error}</p>
        <p>Сохранённые данные не удалены.</p>
        <button onClick={() => location.reload()}>Повторить загрузку</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
