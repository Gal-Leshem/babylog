import { render } from 'preact';

function App() {
  return <main style={{ padding: 24, color: '#ddd', background: '#000', minHeight: '100vh' }}>BabyLog {__APP_COMMIT__}</main>;
}

render(<App />, document.getElementById('app')!);
